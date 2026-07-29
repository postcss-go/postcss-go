/* Minimal Node-API transport: C owns Node values, async-work, and buffers;
 * Go owns operation dispatch, codecs, processing, maps, and errors. */
#if defined(__has_include)
#  if __has_include(<node_api.h>)
#    include <node_api.h>
#  elif __has_include("../node_modules/node-api-headers/include/node_api.h")
#    include "../node_modules/node-api-headers/include/node_api.h"
#  else
#    error "node_api.h not found; run pnpm install or build via node-gyp"
#  endif
#else
#  include <node_api.h>
#endif
#include <limits.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "go-out/libpostcssgo.h"
#define ERROR_CAPACITY 4096
#define INITIAL_OUTPUT_CAPACITY (1 << 20)
typedef enum { OP_PARSE, OP_STRINGIFY, OP_PROCESS, OP_NO_WORK } operation;
typedef struct {
  const char* name;
  const char* usage;
  const char* resource;
  operation op;
  bool input_is_buffer;
  bool output_is_string;
  bool async;
} binding;
typedef struct {
  char* data;
  size_t length;
  bool owned;
} input;
typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  const binding* spec;
  input first;
  input second;
  char* result;
  size_t result_length;
  char error[ERROR_CAPACITY];
  bool failed;
} async_task;
static const binding bindings[] = {
    {"parse", "parse(css, from?)", NULL, OP_PARSE, false, false, false},
    {"parseAsync", "parseAsync(css, from?)", "postcss-go:parse", OP_PARSE, false, false, true},
    {"stringify", "stringify(astBuffer, optionsJson?)", NULL, OP_STRINGIFY, true, true, false},
    {"stringifyAsync", "stringifyAsync(astBuffer, optionsJson?)", "postcss-go:stringify", OP_STRINGIFY, true, true, true},
    {"process", "process(css, optionsJson?)", NULL, OP_PROCESS, false, true, false},
    {"processAsync", "processAsync(css, optionsJson?)", "postcss-go:process", OP_PROCESS, false, true, true},
    {"noWork", "noWork(css, optionsJson?)", NULL, OP_NO_WORK, false, true, false},
    {"noWorkAsync", "noWorkAsync(css, optionsJson?)", "postcss-go:noWork", OP_NO_WORK, false, true, true},
};

static napi_value throw_error(napi_env env, const char* message) {
  napi_throw_error(env, NULL, message && message[0]
      ? message : "postcss-go native error");
  return NULL;
}

static void free_input(input* value) {
  if (value->owned) free(value->data);
  memset(value, 0, sizeof(*value));
}

static int copy_input(const void* data, size_t length, input* out) {
  char* copy = length ? (char*)malloc(length) : NULL;
  if (length && !copy) return -1;
  if (length) memcpy(copy, data, length);
  *out = (input){copy, length, true};
  return 0;
}

static int read_input(
    napi_env env, napi_value value, bool buffer, bool copy_buffer, input* out) {
  size_t length = 0;
  void* data = NULL;

  if (buffer) {
    bool is_buffer = false;
    if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) {
      napi_throw_type_error(env, NULL, "stringify expects a Buffer");
      return -1;
    }
    if (napi_get_buffer_info(env, value, &data, &length) != napi_ok) return -1;
    if (length > INT_MAX) {
      throw_error(env, "native input exceeds the 2 GiB ABI limit");
      return -1;
    }
    if (copy_buffer) return copy_input(data, length, out);
    *out = (input){(char*)data, length, false};
    return 0;
  }

  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return -1;
  if (length > INT_MAX) {
    throw_error(env, "native input exceeds the 2 GiB ABI limit");
    return -1;
  }
  char* text = (char*)malloc(length + 1);
  if (!text) {
    throw_error(env, "out of memory");
    return -1;
  }
  if (napi_get_value_string_utf8(env, value, text, length + 1, &length) != napi_ok) {
    free(text);
    return -1;
  }
  *out = (input){text, length, true};
  return 0;
}

static int read_optional(
    napi_env env, size_t argc, napi_value* argv, input* out) {
  napi_valuetype type;
  if (argc < 2) return 0;
  if (napi_typeof(env, argv[1], &type) != napi_ok) return -1;
  return type == napi_string ? read_input(env, argv[1], false, false, out) : 0;
}

static int call_go(
    operation op, const input* first, const input* second,
    char** result, size_t* result_length, char* error) {
  int capacity = INITIAL_OUTPUT_CAPACITY;
  char* buffer = NULL;

  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      strcpy(error, "out of memory");
      return -1;
    }
    buffer = next;
    error[0] = '\0';
    int written = pcgoCall(
        (unsigned char)op,
        first->data, (int)first->length,
        second->data, (int)second->length,
        buffer, capacity, error, ERROR_CAPACITY - 1);
    if (written < 0) {
      free(buffer);
      if (!error[0]) strcpy(error, "postcss-go native error");
      return -1;
    }
    if (written <= capacity) {
      *result = buffer;
      *result_length = (size_t)written;
      return 0;
    }
    capacity = written;
  }
}

static napi_value make_output(
    napi_env env, bool string, const char* data, size_t length) {
  napi_value value;
  napi_status status = string
      ? napi_create_string_utf8(env, data, length, &value)
      : napi_create_buffer_copy(env, length, data, NULL, &value);
  return status == napi_ok ? value : NULL;
}

static void destroy_task(async_task* task) {
  if (!task) return;
  free_input(&task->first);
  free_input(&task->second);
  free(task->result);
  free(task);
}

static void reject(napi_env env, napi_deferred deferred, const char* message) {
  napi_value text;
  napi_value error;
  if (napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text) == napi_ok &&
      napi_create_error(env, NULL, text, &error) == napi_ok) {
    napi_reject_deferred(env, deferred, error);
  }
}

static void execute_async(napi_env env, void* data) {
  (void)env;
  async_task* task = (async_task*)data;
  task->failed = call_go(
      task->spec->op, &task->first, &task->second,
      &task->result, &task->result_length, task->error) != 0;
}

static void complete_async(napi_env env, napi_status status, void* data) {
  async_task* task = (async_task*)data;
  napi_value value = NULL;
  if (status == napi_ok && !task->failed) {
    value = make_output(
        env, task->spec->output_is_string, task->result, task->result_length);
  }
  if (value) {
    napi_resolve_deferred(env, task->deferred, value);
  } else {
    reject(env, task->deferred, status != napi_ok
        ? "postcss-go native async work was cancelled"
        : task->failed ? task->error : "failed to create postcss-go native result");
  }
  napi_delete_async_work(env, task->work);
  destroy_task(task);
}

static napi_value dispatch(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  const binding* spec = NULL;
  if (napi_get_cb_info(
          env, info, &argc, argv, NULL, (void**)&spec) != napi_ok) return NULL;
  if (argc < 1) {
    napi_throw_type_error(env, NULL, spec->usage);
    return NULL;
  }

  if (!spec->async) {
    input first = {0};
    input second = {0};
    char* result = NULL;
    size_t result_length = 0;
    char error[ERROR_CAPACITY] = {0};
    if (read_input(env, argv[0], spec->input_is_buffer, false, &first) != 0 ||
        read_optional(env, argc, argv, &second) != 0) {
      free_input(&first);
      free_input(&second);
      return NULL;
    }
    int failed = call_go(
        spec->op, &first, &second, &result, &result_length, error);
    free_input(&first);
    free_input(&second);
    if (failed) return throw_error(env, error);
    napi_value value = make_output(
        env, spec->output_is_string, result, result_length);
    free(result);
    return value;
  }

  async_task* task = (async_task*)calloc(1, sizeof(*task));
  if (!task) return throw_error(env, "out of memory");
  task->spec = spec;
  if (read_input(env, argv[0], spec->input_is_buffer, true, &task->first) != 0 ||
      read_optional(env, argc, argv, &task->second) != 0) {
    destroy_task(task);
    return NULL;
  }

  napi_value promise;
  napi_value resource;
  if (napi_create_promise(env, &task->deferred, &promise) != napi_ok) {
    destroy_task(task);
    return throw_error(env, "failed to create postcss-go native Promise");
  }
  if (napi_create_string_utf8(
          env, spec->resource, NAPI_AUTO_LENGTH, &resource) != napi_ok ||
      napi_create_async_work(
          env, NULL, resource, execute_async, complete_async,
          task, &task->work) != napi_ok) {
    reject(env, task->deferred, "failed to create postcss-go native async work");
    if (task->work) napi_delete_async_work(env, task->work);
    destroy_task(task);
    return promise;
  }
  if (napi_queue_async_work(env, task->work) != napi_ok) {
    reject(env, task->deferred, "failed to queue postcss-go native async work");
    napi_delete_async_work(env, task->work);
    destroy_task(task);
  }
  return promise;
}

NAPI_MODULE_INIT() {
  for (size_t i = 0; i < sizeof(bindings) / sizeof(bindings[0]); i++) {
    napi_value fn;
    if (napi_create_function(
            env, bindings[i].name, NAPI_AUTO_LENGTH,
            dispatch, (void*)&bindings[i], &fn) != napi_ok ||
        napi_set_named_property(env, exports, bindings[i].name, fn) != napi_ok) {
      return NULL;
    }
  }
  return exports;
}
