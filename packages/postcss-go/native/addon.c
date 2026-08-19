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
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#if defined(POSTCSS_GO_DYNAMIC_LIBRARY)
#  include <windows.h>
#endif
#if defined(__has_include)
#  if __has_include("go-out/libpostcssgo.h")
#    include "go-out/libpostcssgo.h"
#  elif __has_include("libpostcssgo.h")
#    include "libpostcssgo.h"
#  else
#    error "libpostcssgo.h not found; build the Go c-archive first"
#  endif
#else
#  include "go-out/libpostcssgo.h"
#endif
#define ERROR_CAPACITY 4096
#define MINIMUM_OUTPUT_CAPACITY (1 << 12)
#define HANDLE_SCRATCH_CAPACITY (1 << 20)
static char handle_scratch[HANDLE_SCRATCH_CAPACITY];

#if defined(POSTCSS_GO_DYNAMIC_LIBRARY)
typedef int (*pcgo_call_function)(
    unsigned char, char*, int, char*, int, char*, int, char*, int);
static INIT_ONCE go_bridge_once = INIT_ONCE_STATIC_INIT;
static HMODULE go_bridge_library = NULL;
static pcgo_call_function go_bridge_call = NULL;
static char go_bridge_error[ERROR_CAPACITY] = {0};
extern IMAGE_DOS_HEADER __ImageBase;

static BOOL CALLBACK load_go_bridge(
    PINIT_ONCE once, PVOID parameter, PVOID* context) {
  (void)once;
  (void)parameter;
  (void)context;
  wchar_t module_path[32768];
  DWORD length = GetModuleFileNameW(
      (HMODULE)&__ImageBase, module_path,
      (DWORD)(sizeof(module_path) / sizeof(module_path[0])));
  wchar_t* separator = length ? wcsrchr(module_path, L'\\') : NULL;
  const wchar_t companion[] = L"libpostcssgo.dll";
  size_t remaining = separator
      ? (sizeof(module_path) / sizeof(module_path[0])) -
          (size_t)(separator + 1 - module_path)
      : 0;
  if (!separator || length == 0 || length >= sizeof(module_path) / sizeof(module_path[0]) ||
      wcslen(companion) + 1 > remaining) {
    strcpy(go_bridge_error, "failed to resolve postcss-go native companion path");
    return TRUE;
  }
  wcscpy_s(separator + 1, remaining, companion);

  go_bridge_library = LoadLibraryW(module_path);
  if (!go_bridge_library) {
    snprintf(go_bridge_error, sizeof(go_bridge_error),
        "failed to load postcss-go native companion (Windows error %lu)",
        (unsigned long)GetLastError());
    return TRUE;
  }
  go_bridge_call = (pcgo_call_function)GetProcAddress(go_bridge_library, "pcgoCall");
  if (!go_bridge_call) {
    snprintf(go_bridge_error, sizeof(go_bridge_error),
        "postcss-go native companion is missing pcgoCall (Windows error %lu)",
        (unsigned long)GetLastError());
  }
  return TRUE;
}

static int initialize_go_bridge(char* error) {
  if (!InitOnceExecuteOnce(&go_bridge_once, load_go_bridge, NULL, NULL) ||
      !go_bridge_call) {
    strncpy(error, go_bridge_error[0] ? go_bridge_error :
        "failed to initialize postcss-go native companion", ERROR_CAPACITY - 1);
    error[ERROR_CAPACITY - 1] = '\0';
    return -1;
  }
  return 0;
}

static int call_go_bridge(
    unsigned char operation, char* first, int first_len,
    char* second, int second_len, char* output, int output_capacity,
    char* error, int error_capacity) {
  return go_bridge_call(operation, first, first_len, second, second_len,
      output, output_capacity, error, error_capacity);
}
#else
static int initialize_go_bridge(char* error) {
  (void)error;
  return 0;
}

static int call_go_bridge(
    unsigned char operation, char* first, int first_len,
    char* second, int second_len, char* output, int output_capacity,
    char* error, int error_capacity) {
  return pcgoCall(operation, first, first_len, second, second_len,
      output, output_capacity, error, error_capacity);
}
#endif

typedef enum { OP_PARSE, OP_STRINGIFY, OP_PROCESS, OP_NO_WORK, OP_STRINGIFY_BUILDER } operation;
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
    {"process", "process(css, optionsJson?)", NULL, OP_PROCESS, false, false, false},
    {"processAsync", "processAsync(css, optionsJson?)", "postcss-go:process", OP_PROCESS, false, false, true},
    {"noWork", "noWork(css, optionsJson?)", NULL, OP_NO_WORK, false, true, false},
    {"noWorkAsync", "noWorkAsync(css, optionsJson?)", "postcss-go:noWork", OP_NO_WORK, false, true, true},
    {"stringifyBuilder", "stringifyBuilder(astBuffer, optionsJson?)", NULL, OP_STRINGIFY_BUILDER, true, true, false},
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
  size_t input_length = first->length;
  if (second->length > (size_t)INT_MAX - input_length) {
    input_length = INT_MAX;
  } else {
    input_length += second->length;
  }
  size_t estimated = input_length > (size_t)INT_MAX / 2
      ? (size_t)INT_MAX
      : input_length * 2;
  int capacity = (int)(estimated < MINIMUM_OUTPUT_CAPACITY
      ? MINIMUM_OUTPUT_CAPACITY : estimated);
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
    int written = call_go_bridge(
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
    return value ? value : throw_error(env, "failed to create postcss-go native result");
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

static napi_value handle_parse(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  size_t length = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) return NULL;
  char* css = (char*)malloc(length + 1);
  if (!css) return throw_error(env, "out of memory");
  if (napi_get_value_string_utf8(env, argv[0], css, length + 1, &length) != napi_ok) {
    free(css);
    return NULL;
  }
  uint32_t handle = pcgoHandleParse(css, (int)length);
  free(css);
  if (handle == 0) return throw_error(env, "handle parse failed");
  if (napi_create_uint32(env, handle, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_close(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  pcgoHandleClose();
  return NULL;
}

static napi_value handle_type(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &handle) != napi_ok) return NULL;
  if (napi_create_int32(env, pcgoHandleType(handle), &result) != napi_ok) return NULL;
  return result;
}

static int read_handle_field(
    uint32_t handle, int32_t field, char** out, size_t* out_length) {
  int capacity = HANDLE_SCRATCH_CAPACITY;
  char* buffer = NULL;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      return -1;
    }
    buffer = next;
    int written = pcgoHandleGetField(handle, field, buffer, capacity);
    if (written < 0) {
      free(buffer);
      return -1;
    }
    if (written <= capacity) {
      *out = buffer;
      *out_length = (size_t)written;
      return 0;
    }
    capacity = written;
  }
}

static napi_value handle_get_field(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t handle = 0;
  int32_t field = 0;
  napi_value result;
  char* value = NULL;
  size_t length = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &handle) != napi_ok) return NULL;
  if (napi_get_value_int32(env, argv[1], &field) != napi_ok) return NULL;
  if (read_handle_field(handle, field, &value, &length) != 0) {
    return throw_error(env, "handle getField failed");
  }
  if (napi_create_string_utf8(env, value, length, &result) != napi_ok) {
    free(value);
    return NULL;
  }
  free(value);
  return result;
}

static napi_value handle_set_field(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  uint32_t handle = 0;
  int32_t field = 0;
  size_t length = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &handle) != napi_ok) return NULL;
  if (napi_get_value_int32(env, argv[1], &field) != napi_ok) return NULL;
  if (napi_get_value_string_utf8(env, argv[2], handle_scratch, HANDLE_SCRATCH_CAPACITY, &length) != napi_ok) {
    return NULL;
  }
  if (pcgoHandleSetField(handle, field, handle_scratch, (int)length) < 0) {
    return throw_error(env, "handle setField failed");
  }
  return NULL;
}

static napi_value handle_walk_decls(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t root = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &root) != napi_ok) return NULL;
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (type != napi_uint32_array) {
    napi_throw_type_error(env, NULL, "expected Uint32Array");
    return NULL;
  }
  int count = pcgoHandleWalkDecls(root, (unsigned int*)data, (int)length);
  if (count < 0) return throw_error(env, "handle walkDecls failed");
  if (napi_create_int32(env, count, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_open_cursor(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t root = 0;
  bool decls_only = true;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &root) != napi_ok) return NULL;
  if (argc > 1 && napi_get_value_bool(env, argv[1], &decls_only) != napi_ok) return NULL;
  int id = pcgoHandleOpenCursor(root, decls_only ? 1 : 0);
  if (id < 0) return throw_error(env, "handle openCursor failed");
  if (napi_create_int32(env, id, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_cursor_next(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t id = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_int32(env, argv[0], &id) != napi_ok) return NULL;
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  int count = pcgoHandleCursorNext(id, (unsigned int*)data, (int)length);
  if (count < 0) return throw_error(env, "handle cursorNext failed");
  if (napi_create_int32(env, count, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_close_cursor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t id = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_int32(env, argv[0], &id) != napi_ok) return NULL;
  pcgoHandleCloseCursor(id);
  return NULL;
}

static napi_value decode_packed_strings(napi_env env, int written, napi_value* out_array) {
  napi_value array;
  if (napi_create_array(env, &array) != napi_ok) return NULL;
  int cursor = 0;
  uint32_t index = 0;
  while (cursor + 4 <= written) {
    uint32_t size = (uint32_t)(unsigned char)handle_scratch[cursor] |
                    ((uint32_t)(unsigned char)handle_scratch[cursor + 1] << 8) |
                    ((uint32_t)(unsigned char)handle_scratch[cursor + 2] << 16) |
                    ((uint32_t)(unsigned char)handle_scratch[cursor + 3] << 24);
    cursor += 4;
    napi_value item;
    if (napi_create_string_utf8(env, handle_scratch + cursor, size, &item) != napi_ok) return NULL;
    if (napi_set_element(env, array, index++, item) != napi_ok) return NULL;
    cursor += (int)size;
  }
  *out_array = array;
  return array;
}

static napi_value handle_read_fields(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  napi_value array;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (napi_get_value_int32(env, argv[1], &field) != napi_ok) return NULL;
  int written = pcgoHandleReadFields((unsigned int*)data, (int)length, field, handle_scratch, HANDLE_SCRATCH_CAPACITY);
  if (written < 0) return throw_error(env, "handle readFields failed");
  if (decode_packed_strings(env, written, &array) == NULL) return NULL;
  return array;
}

static napi_value handle_set_fields(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  uint32_t count = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (napi_get_value_int32(env, argv[1], &field) != napi_ok) return NULL;
  if (napi_get_array_length(env, argv[2], &count) != napi_ok) return NULL;

  int packed = 0;
  for (uint32_t i = 0; i < count; i++) {
    napi_value item;
    size_t item_length = 0;
    if (napi_get_element(env, argv[2], i, &item) != napi_ok) return NULL;
    if (napi_get_value_string_utf8(env, item, NULL, 0, &item_length) != napi_ok) return NULL;
    if (packed + 4 + (int)item_length > HANDLE_SCRATCH_CAPACITY) {
      return throw_error(env, "handle setFields overflow");
    }
    handle_scratch[packed] = (char)item_length;
    handle_scratch[packed + 1] = (char)(item_length >> 8);
    handle_scratch[packed + 2] = (char)(item_length >> 16);
    handle_scratch[packed + 3] = (char)(item_length >> 24);
    packed += 4;
    if (napi_get_value_string_utf8(env, item, handle_scratch + packed, HANDLE_SCRATCH_CAPACITY - packed, &item_length) != napi_ok) {
      return NULL;
    }
    packed += (int)item_length;
  }
  if (pcgoHandleSetFields((unsigned int*)data, (int)length, field, handle_scratch, packed) < 0) {
    return throw_error(env, "handle setFields failed");
  }
  return NULL;
}

static int read_handle_stringify(uint32_t handle, char** out, size_t* out_length) {
  int capacity = MINIMUM_OUTPUT_CAPACITY;
  char* buffer = NULL;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      return -1;
    }
    buffer = next;
    int written = pcgoHandleStringify(handle, buffer, capacity);
    if (written < 0) {
      free(buffer);
      return -1;
    }
    if (written <= capacity) {
      *out = buffer;
      *out_length = (size_t)written;
      return 0;
    }
    capacity = written;
  }
}

static napi_value handle_stringify(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;
  napi_value result;
  char* css = NULL;
  size_t length = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &handle) != napi_ok) return NULL;
  if (read_handle_stringify(handle, &css, &length) != 0) {
    return throw_error(env, "handle stringify failed");
  }
  if (napi_create_string_utf8(env, css, length, &result) != napi_ok) {
    free(css);
    return NULL;
  }
  free(css);
  return result;
}

static napi_value handle_new_decl(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  size_t prop_len = 0;
  size_t value_len = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_string_utf8(env, argv[0], handle_scratch, HANDLE_SCRATCH_CAPACITY / 2, &prop_len) != napi_ok) {
    return NULL;
  }
  if (napi_get_value_string_utf8(env, argv[1], handle_scratch + (HANDLE_SCRATCH_CAPACITY / 2), HANDLE_SCRATCH_CAPACITY / 2, &value_len) != napi_ok) {
    return NULL;
  }
  uint32_t handle = pcgoHandleNewDecl(handle_scratch, (int)prop_len, handle_scratch + (HANDLE_SCRATCH_CAPACITY / 2), (int)value_len);
  if (handle == 0) return throw_error(env, "handle newDecl failed");
  if (napi_create_uint32(env, handle, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_append(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t parent = 0;
  uint32_t child = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &parent) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[1], &child) != napi_ok) return NULL;
  if (pcgoHandleAppend(parent, child) < 0) return throw_error(env, "handle append failed");
  return NULL;
}

static napi_value handle_dispose(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return NULL;
  if (napi_get_value_uint32(env, argv[0], &handle) != napi_ok) return NULL;
  if (pcgoHandleDispose(handle) < 0) return throw_error(env, "handle dispose failed");
  return NULL;
}

static int register_handle_binding(
    napi_env env, napi_value exports, const char* name, napi_callback cb) {
  napi_value fn;
  if (napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL, &fn) != napi_ok) {
    return -1;
  }
  return napi_set_named_property(env, exports, name, fn);
}

NAPI_MODULE_INIT() {
  char bridge_error[ERROR_CAPACITY] = {0};
  if (initialize_go_bridge(bridge_error) != 0) {
    return throw_error(env, bridge_error);
  }
  for (size_t i = 0; i < sizeof(bindings) / sizeof(bindings[0]); i++) {
    napi_value fn;
    if (napi_create_function(
            env, bindings[i].name, NAPI_AUTO_LENGTH,
            dispatch, (void*)&bindings[i], &fn) != napi_ok ||
        napi_set_named_property(env, exports, bindings[i].name, fn) != napi_ok) {
      return NULL;
    }
  }
  const struct {
    const char* name;
    napi_callback fn;
  } handle_bindings[] = {
      {"handleParse", handle_parse},
      {"handleClose", handle_close},
      {"handleType", handle_type},
      {"handleGetField", handle_get_field},
      {"handleSetField", handle_set_field},
      {"handleWalkDecls", handle_walk_decls},
      {"handleOpenCursor", handle_open_cursor},
      {"handleCursorNext", handle_cursor_next},
      {"handleCloseCursor", handle_close_cursor},
      {"handleReadFields", handle_read_fields},
      {"handleSetFields", handle_set_fields},
      {"handleStringify", handle_stringify},
      {"handleNewDecl", handle_new_decl},
      {"handleAppend", handle_append},
      {"handleDispose", handle_dispose},
  };
  for (size_t i = 0; i < sizeof(handle_bindings) / sizeof(handle_bindings[0]); i++) {
    if (register_handle_binding(env, exports, handle_bindings[i].name, handle_bindings[i].fn) != 0) {
      return NULL;
    }
  }
  return exports;
}
