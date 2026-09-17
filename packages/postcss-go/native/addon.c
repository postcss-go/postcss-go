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
#include "handle_protocol.h"
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
#define HANDLE_SCRATCH_CAPACITY (1 << 12)

#if defined(POSTCSS_GO_DYNAMIC_LIBRARY)
typedef int (*pcgo_call_function)(
    unsigned char, char*, int, char*, int, char*, int, char*, int);
typedef unsigned int (*pcgo_handle_parse_fn)(char*, int, unsigned int*, char*, int, pcgoHandleError*);
typedef void (*pcgo_handle_close_fn)(unsigned int);
typedef unsigned int (*pcgo_handle_count_fn)(void);
typedef void (*pcgo_handle_free_error_fn)(pcgoHandleError*);
typedef int (*pcgo_handle_type_fn)(unsigned int, unsigned int, pcgoHandleError*);
typedef int (*pcgo_handle_get_field_fn)(unsigned int, unsigned int, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_set_field_fn)(unsigned int, unsigned int, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_walk_decls_fn)(unsigned int, unsigned int, unsigned int*, int, pcgoHandleError*);
typedef unsigned int (*pcgo_handle_open_cursor_fn)(unsigned int, unsigned int, int, pcgoHandleError*);
typedef int (*pcgo_handle_cursor_next_fn)(unsigned int, unsigned int, unsigned int*, int, pcgoHandleError*);
typedef int (*pcgo_handle_close_cursor_fn)(unsigned int, unsigned int, pcgoHandleError*);
typedef int (*pcgo_handle_read_snapshots_fn)(unsigned int, unsigned int*, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_read_fields_fn)(unsigned int, unsigned int*, int, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_set_fields_fn)(unsigned int, unsigned int*, int, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_apply_patches_fn)(unsigned int, unsigned int*, int*, int, char*, int, pcgoHandleError*);
typedef unsigned int (*pcgo_handle_new_decl_fn)(unsigned int, char*, int, char*, int, pcgoHandleError*);
typedef int (*pcgo_handle_append_fn)(unsigned int, unsigned int, unsigned int, pcgoHandleError*);
typedef int (*pcgo_handle_dispose_fn)(unsigned int, unsigned int, pcgoHandleError*);
typedef int (*pcgo_handle_stringify_fn)(unsigned int, unsigned int, char*, int, pcgoHandleError*);
static INIT_ONCE go_bridge_once = INIT_ONCE_STATIC_INIT;
static HMODULE go_bridge_library = NULL;
static pcgo_call_function go_bridge_call = NULL;
static pcgo_handle_parse_fn go_handle_parse = NULL;
static pcgo_handle_close_fn go_handle_close = NULL;
static pcgo_handle_count_fn go_handle_count = NULL;
static pcgo_handle_free_error_fn go_handle_free_error = NULL;
static pcgo_handle_type_fn go_handle_type = NULL;
static pcgo_handle_get_field_fn go_handle_get_field = NULL;
static pcgo_handle_set_field_fn go_handle_set_field = NULL;
static pcgo_handle_walk_decls_fn go_handle_walk_decls = NULL;
static pcgo_handle_open_cursor_fn go_handle_open_cursor = NULL;
static pcgo_handle_cursor_next_fn go_handle_cursor_next = NULL;
static pcgo_handle_close_cursor_fn go_handle_close_cursor = NULL;
static pcgo_handle_read_fields_fn go_handle_read_fields = NULL;
static pcgo_handle_read_snapshots_fn go_handle_read_snapshots = NULL;
static pcgo_handle_set_fields_fn go_handle_set_fields = NULL;
static pcgo_handle_apply_patches_fn go_handle_apply_patches = NULL;
static pcgo_handle_new_decl_fn go_handle_new_decl = NULL;
static pcgo_handle_append_fn go_handle_append = NULL;
static pcgo_handle_dispose_fn go_handle_dispose = NULL;
static pcgo_handle_stringify_fn go_handle_stringify = NULL;
static char go_bridge_error[ERROR_CAPACITY] = {0};
extern IMAGE_DOS_HEADER __ImageBase;

static FARPROC require_go_symbol(const char* name) {
  FARPROC symbol = GetProcAddress(go_bridge_library, name);
  if (!symbol) {
    if (!go_bridge_error[0]) {
      snprintf(go_bridge_error, sizeof(go_bridge_error),
          "postcss-go native companion is missing %s (Windows error %lu)",
          name, (unsigned long)GetLastError());
    }
    go_bridge_call = NULL;
  }
  return symbol;
}

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
  go_bridge_call = (pcgo_call_function)require_go_symbol("pcgoCall");
  go_handle_parse = (pcgo_handle_parse_fn)require_go_symbol("pcgoHandleParseV2_1");
  go_handle_close = (pcgo_handle_close_fn)require_go_symbol("pcgoHandleCloseV2");
  go_handle_free_error = (pcgo_handle_free_error_fn)require_go_symbol("pcgoHandleFreeErrorV2_1");
  go_handle_count = (pcgo_handle_count_fn)require_go_symbol("pcgoHandleSessionCountV2");
  go_handle_type = (pcgo_handle_type_fn)require_go_symbol("pcgoHandleTypeV2_1");
  go_handle_get_field = (pcgo_handle_get_field_fn)require_go_symbol("pcgoHandleGetFieldV2_1");
  go_handle_set_field = (pcgo_handle_set_field_fn)require_go_symbol("pcgoHandleSetFieldV2_1");
  go_handle_walk_decls = (pcgo_handle_walk_decls_fn)require_go_symbol("pcgoHandleWalkDeclsV2_1");
  go_handle_open_cursor = (pcgo_handle_open_cursor_fn)require_go_symbol("pcgoHandleOpenCursorV2_1");
  go_handle_cursor_next = (pcgo_handle_cursor_next_fn)require_go_symbol("pcgoHandleCursorNextV2_1");
  go_handle_close_cursor = (pcgo_handle_close_cursor_fn)require_go_symbol("pcgoHandleCloseCursorV2_1");
  // Optional 2.2/2.3 features: an older companion must retain the binary/scalar bridge.
  go_handle_read_snapshots = (pcgo_handle_read_snapshots_fn)GetProcAddress(go_bridge_library, "pcgoHandleReadSnapshotsV2_1");
  go_handle_apply_patches = (pcgo_handle_apply_patches_fn)GetProcAddress(go_bridge_library, "pcgoHandleApplyPatchesV2_1");
  go_handle_read_fields = (pcgo_handle_read_fields_fn)require_go_symbol("pcgoHandleReadFieldsV2_1");
  go_handle_set_fields = (pcgo_handle_set_fields_fn)require_go_symbol("pcgoHandleSetFieldsV2_1");
  go_handle_new_decl = (pcgo_handle_new_decl_fn)require_go_symbol("pcgoHandleNewDeclV2_1");
  go_handle_append = (pcgo_handle_append_fn)require_go_symbol("pcgoHandleAppendV2_1");
  go_handle_dispose = (pcgo_handle_dispose_fn)require_go_symbol("pcgoHandleDisposeV2_1");
  go_handle_stringify = (pcgo_handle_stringify_fn)require_go_symbol("pcgoHandleStringifyV2_1");
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

#define pcgoHandleParseV2_1 go_handle_parse
#define pcgoHandleCloseV2 go_handle_close
#define pcgoHandleSessionCountV2 go_handle_count
#define pcgoHandleFreeErrorV2_1 go_handle_free_error
#define pcgoHandleTypeV2_1 go_handle_type
#define pcgoHandleGetFieldV2_1 go_handle_get_field
#define pcgoHandleSetFieldV2_1 go_handle_set_field
#define pcgoHandleWalkDeclsV2_1 go_handle_walk_decls
#define pcgoHandleOpenCursorV2_1 go_handle_open_cursor
#define pcgoHandleCursorNextV2_1 go_handle_cursor_next
#define pcgoHandleCloseCursorV2_1 go_handle_close_cursor
#define pcgoHandleReadSnapshotsV2_1 go_handle_read_snapshots
#define pcgoHandleReadFieldsV2_1 go_handle_read_fields
#define pcgoHandleSetFieldsV2_1 go_handle_set_fields
#define pcgoHandleApplyPatchesV2_1 go_handle_apply_patches
#define pcgoHandleNewDeclV2_1 go_handle_new_decl
#define pcgoHandleAppendV2_1 go_handle_append
#define pcgoHandleDisposeV2_1 go_handle_dispose
#define pcgoHandleStringifyV2_1 go_handle_stringify
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

#if defined(POSTCSS_GO_DYNAMIC_LIBRARY)
#define PCGO_HAS_APPLY_PATCHES (go_handle_apply_patches != NULL)
#else
#define PCGO_HAS_APPLY_PATCHES 1
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

// The Go error belongs only to this native invocation; nested sessions cannot overwrite it.
static napi_value throw_handle_error(napi_env env, pcgoHandleError* detail) {
  napi_value message, error, code;
  const char* text = detail->message ? detail->message : "native handle transport failure";
  napi_status status = napi_create_string_utf8(env, text, detail->message ? detail->length : NAPI_AUTO_LENGTH, &message);
  pcgoHandleFreeErrorV2_1(detail);
  if (status != napi_ok || napi_create_error(env, NULL, message, &error) != napi_ok) return NULL;
  if (napi_create_uint32(env, detail->code ? detail->code : HANDLE_STATUS_INTERNAL, &code) != napi_ok ||
      napi_set_named_property(env, error, "status", code) != napi_ok) return NULL;
  napi_throw(env, error);
  return NULL;
}

// N-API's uint32 conversion wraps negatives and large values. IDs must never wrap.
static napi_status read_handle_id(napi_env env, napi_value value, uint32_t* out) {
  double number;
  if (napi_get_value_double(env, value, &number) != napi_ok ||
      !(number >= 0 && number <= UINT32_MAX) || number != (double)(uint32_t)number) return napi_invalid_arg;
  *out = (uint32_t)number;
  return napi_ok;
}

static napi_status read_handle_field_id(napi_env env, napi_value value, int32_t* out) {
  uint32_t field;
  if (read_handle_id(env, value, &field) != napi_ok || field > INT32_MAX) return napi_invalid_arg;
  *out = (int32_t)field;
  return napi_ok;
}

static napi_value handle_protocol_info(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result, value, buffer, capabilities;
  void* data;
  if (napi_create_object(env, &result) != napi_ok) return NULL;
  const char* names[] = {"major", "minor", "maxBatchSize", "activeSessions"};
  const uint32_t values[] = {HANDLE_PROTOCOL_MAJOR, HANDLE_PROTOCOL_MINOR, HANDLE_MAX_BATCH_SIZE, pcgoHandleSessionCountV2()};
  for (int i = 0; i < 4; i++) {
    if (napi_create_uint32(env, values[i], &value) != napi_ok ||
        napi_set_named_property(env, result, names[i], value) != napi_ok) return NULL;
  }
  if (napi_create_arraybuffer(env, sizeof(uint32_t), &data, &buffer) != napi_ok) return NULL;
  *((uint32_t*)data) = HANDLE_CAPABILITIES;
#ifdef _WIN32
  if (!go_handle_read_snapshots) *((uint32_t*)data) &= ~HANDLE_CAPABILITY_READONLYFACADE;
  if (!go_handle_apply_patches) *((uint32_t*)data) &= ~HANDLE_CAPABILITY_ATOMICPATCHES;
#endif
  if (napi_create_typedarray(env, napi_uint32_array, 1, buffer, 0, &capabilities) != napi_ok ||
      napi_set_named_property(env, result, "capabilities", capabilities) != napi_ok) return NULL;
  return result;
}

static void finalize_handle_session(napi_env env, void* data, void* hint) {
  (void)env; (void)hint;
  pcgoHandleCloseV2((uint32_t)(uintptr_t)data);
}

static napi_value handle_parse(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  size_t argc = 2;
  napi_value argv[2] = {0};
  size_t length = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (length > INT_MAX) return throw_error(env, "native input exceeds the 2 GiB ABI limit");
  char* css = (char*)malloc(length + 1);
  if (!css) return throw_error(env, "out of memory");
  if (napi_get_value_string_utf8(env, argv[0], css, length + 1, &length) != napi_ok) {
    free(css);
    return NULL;
  }
  input options = {0};
  if (argc > 1) {
    napi_valuetype type;
    if (napi_typeof(env, argv[1], &type) != napi_ok ||
        (type != napi_undefined && (type != napi_string || read_input(env, argv[1], false, false, &options) != 0))) {
      free(css);
      return throw_error(env, "invalid handle parse options: expected JSON string");
    }
  }
  uint32_t root = 0;
  uint32_t handle = pcgoHandleParseV2_1(css, (int)length, &root, options.data, (int)options.length, &error);
  free(css);
  free_input(&options);
  if (handle == 0) return throw_handle_error(env, &error);
  napi_value session_value, root_value;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_uint32(env, handle, &session_value) != napi_ok ||
      napi_create_uint32(env, root, &root_value) != napi_ok ||
      napi_set_named_property(env, result, "sessionId", session_value) != napi_ok ||
      napi_set_named_property(env, result, "rootId", root_value) != napi_ok) {
    pcgoHandleCloseV2(handle);
    return NULL;
  }
  if (napi_add_finalizer(env, result, (void*)(uintptr_t)handle, finalize_handle_session, NULL, NULL) != napi_ok) {
    pcgoHandleCloseV2(handle);
    return NULL;
  }
  return result;
}

static napi_value handle_close(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {0};
  uint32_t session = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  pcgoHandleCloseV2(session);
  return NULL;
}

static napi_value handle_type(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 2;
  napi_value argv[2] = {0};
  uint32_t handle = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &handle) != napi_ok) return throw_error(env, "invalid handle arguments");
  int kind = pcgoHandleTypeV2_1(session, handle, &error);
  if (kind < 0) return throw_handle_error(env, &error);
  if (napi_create_int32(env, kind, &result) != napi_ok) return NULL;
  return result;
}

static int read_handle_field(
    uint32_t session, uint32_t handle, int32_t field, char** out, size_t* out_length, pcgoHandleError* error) {
  int capacity = HANDLE_SCRATCH_CAPACITY;
  char* buffer = NULL;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      return -1;
    }
    buffer = next;
    int written = pcgoHandleGetFieldV2_1(session, handle, field, buffer, capacity, error);
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
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  uint32_t handle = 0;
  int32_t field = 0;
  napi_value result;
  char* value = NULL;
  size_t length = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &handle) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_field_id(env, argv[2], &field) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_field(session, handle, field, &value, &length, &error) != 0) {
    return throw_handle_error(env, &error);
  }
  if (napi_create_string_utf8(env, value, length, &result) != napi_ok) {
    free(value);
    return NULL;
  }
  free(value);
  return result;
}

static napi_value handle_set_field(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 4;
  napi_value argv[4] = {0};
  uint32_t handle = 0;
  int32_t field = 0;
  input value = {0};

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &handle) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_field_id(env, argv[2], &field) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_input(env, argv[3], false, false, &value) != 0) return NULL;
  int status = pcgoHandleSetFieldV2_1(session, handle, field, value.data, (int)value.length, &error);
  free(value.data);
  if (status < 0) {
    return throw_handle_error(env, &error);
  }
  return NULL;
}

static napi_value handle_walk_decls(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  uint32_t root = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &root) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[2], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (type != napi_uint32_array || length > INT_MAX) {
    napi_throw_type_error(env, NULL, "expected Uint32Array");
    return NULL;
  }
  int count = pcgoHandleWalkDeclsV2_1(session, root, (unsigned int*)data, (int)length, &error);
  if (count < 0) return throw_handle_error(env, &error);
  if (napi_create_int32(env, count, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_open_cursor(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  uint32_t root = 0;
  bool decls_only = true;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &root) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (argc > 2 && napi_get_value_bool(env, argv[2], &decls_only) != napi_ok) return NULL;
  uint32_t id = pcgoHandleOpenCursorV2_1(session, root, decls_only ? 1 : 0, &error);
  if (id == 0) return throw_handle_error(env, &error);
  if (napi_create_uint32(env, id, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_cursor_next(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  uint32_t id = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &id) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[2], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (type != napi_uint32_array || length > INT_MAX) return throw_error(env, "expected Uint32Array within ABI limits");
  int count = pcgoHandleCursorNextV2_1(session, id, (unsigned int*)data, (int)length, &error);
  if (count < 0) return throw_handle_error(env, &error);
  if (napi_create_int32(env, count, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_close_cursor(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 2;
  napi_value argv[2] = {0};
  uint32_t id = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &id) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (pcgoHandleCloseCursorV2_1(session, id, &error) < 0) return throw_handle_error(env, &error);
  return NULL;
}

static napi_value decode_packed_strings(napi_env env, const char* handle_scratch, int written, napi_value* out_array) {
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
    if (size > (uint32_t)(written - cursor)) return throw_error(env, "invalid field batch");
    napi_value item;
    if (napi_create_string_utf8(env, handle_scratch + cursor, size, &item) != napi_ok) return NULL;
    if (napi_set_element(env, array, index++, item) != napi_ok) return NULL;
    cursor += (int)size;
  }
  *out_array = array;
  return array;
}

static napi_value handle_read_fields(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 4;
  napi_value argv[4] = {0};
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  napi_value array;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (type != napi_uint32_array || length > INT_MAX) return throw_error(env, "expected Uint32Array within ABI limits");
  if (read_handle_field_id(env, argv[2], &field) != napi_ok) return throw_error(env, "invalid handle arguments");
  int capacity = HANDLE_SCRATCH_CAPACITY;
  char* scratch = NULL;
  for (;;) {
    char* next = (char*)realloc(scratch, (size_t)capacity);
    if (!next) { free(scratch); return throw_error(env, "out of memory"); }
    scratch = next;
    int written = pcgoHandleReadFieldsV2_1(session, (unsigned int*)data, (int)length, field, scratch, capacity, &error);
    if (written < 0) { free(scratch); return throw_handle_error(env, &error); }
    if (written > capacity) { capacity = written; continue; }
    napi_value decoded = decode_packed_strings(env, scratch, written, &array);
    free(scratch);
    if (decoded == NULL) return NULL;
    break;
  }
  return array;
}

static napi_value handle_read_snapshots(napi_env env, napi_callback_info info) {
#ifdef _WIN32
  if (!go_handle_read_snapshots) return throw_error(env, "native companion lacks snapshot capability");
#endif
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 2;
  napi_value argv[2] = {0};
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value array;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (type != napi_uint32_array || length > INT_MAX) return throw_error(env, "expected Uint32Array within ABI limits");
  int capacity = HANDLE_SCRATCH_CAPACITY;
  char* scratch = NULL;
  for (;;) {
    char* next = (char*)realloc(scratch, (size_t)capacity);
    if (!next) { free(scratch); return throw_error(env, "out of memory"); }
    scratch = next;
    int written = pcgoHandleReadSnapshotsV2_1(session, (unsigned int*)data, (int)length, scratch, capacity, &error);
    if (written < 0) { free(scratch); return throw_handle_error(env, &error); }
    if (written > capacity) { capacity = written; continue; }
    napi_status status = napi_create_string_utf8(env, scratch, (size_t)written, &array);
    free(scratch);
    if (status != napi_ok) return NULL;
    break;
  }
  return array;
}

static napi_value handle_set_fields(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 4;
  napi_value argv[4] = {0};
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  uint32_t count = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok) {
    return NULL;
  }
  if (read_handle_field_id(env, argv[2], &field) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (type != napi_uint32_array || length > INT_MAX) return throw_error(env, "expected Uint32Array within ABI limits");
  if (napi_get_array_length(env, argv[3], &count) != napi_ok) return throw_error(env, "invalid handle arguments");

  if (count != length) return throw_error(env, "handle mutation batch length mismatch");
  char* handle_scratch = NULL;
  size_t capacity = 0;
  size_t packed = 0;
  for (uint32_t i = 0; i < count; i++) {
    napi_value item;
    input value = {0};
    if (napi_get_element(env, argv[3], i, &item) != napi_ok ||
        read_input(env, item, false, false, &value) != 0) { free(handle_scratch); return NULL; }
    size_t item_length = value.length;
    size_t required = packed + 4 + item_length;
    if (required > INT_MAX) {
      free(value.data); free(handle_scratch);
      return throw_error(env, "handle batch exceeds the 2 GiB ABI limit");
    }
    if (required > capacity) {
      capacity = required > capacity * 2 ? required : capacity * 2;
      char* next = (char*)realloc(handle_scratch, capacity);
      if (!next) { free(value.data); free(handle_scratch); return throw_error(env, "out of memory"); }
      handle_scratch = next;
    }
    handle_scratch[packed] = (char)item_length;
    handle_scratch[packed + 1] = (char)(item_length >> 8);
    handle_scratch[packed + 2] = (char)(item_length >> 16);
    handle_scratch[packed + 3] = (char)(item_length >> 24);
    packed += 4;
    memcpy(handle_scratch + packed, value.data, item_length);
    free(value.data);
    packed += item_length;
  }
  /* Array element getters may reenter JS and detach/resize the ID buffer. */
  if (napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset) != napi_ok ||
      length != count || (count && !data)) {
    free(handle_scratch);
    return throw_error(env, "handle IDs changed during batch construction");
  }
  int status = pcgoHandleSetFieldsV2_1(session, (unsigned int*)data, (int)length, field, handle_scratch, (int)packed, &error);
  free(handle_scratch);
  if (status < 0) {
    return throw_handle_error(env, &error);
  }
  return NULL;
}

static napi_value handle_apply_patches(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 4;
  napi_value argv[4] = {0};
  napi_typedarray_type handle_type;
  napi_typedarray_type field_type;
  size_t handle_length = 0;
  size_t field_length = 0;
  void* handle_data = NULL;
  void* field_data = NULL;
  napi_value handle_buffer;
  napi_value field_buffer;
  size_t handle_offset = 0;
  size_t field_offset = 0;
  uint32_t count = 0;

  if (!PCGO_HAS_APPLY_PATCHES) return throw_error(env, "atomic patches capability unavailable");
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (napi_get_typedarray_info(env, argv[1], &handle_type, &handle_length, &handle_data, &handle_buffer, &handle_offset) != napi_ok) {
    return NULL;
  }
  if (napi_get_typedarray_info(env, argv[2], &field_type, &field_length, &field_data, &field_buffer, &field_offset) != napi_ok) {
    return NULL;
  }
  if (handle_type != napi_uint32_array || field_type != napi_int32_array ||
      handle_length > INT_MAX || field_length > INT_MAX) {
    return throw_error(env, "expected Uint32Array/Int32Array within ABI limits");
  }
  if (handle_length != field_length) return throw_error(env, "handle mutation batch length mismatch");
  if (napi_get_array_length(env, argv[3], &count) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (count != handle_length) return throw_error(env, "handle mutation batch length mismatch");

  char* handle_scratch = NULL;
  size_t capacity = 0;
  size_t packed = 0;
  for (uint32_t i = 0; i < count; i++) {
    napi_value item;
    input value = {0};
    if (napi_get_element(env, argv[3], i, &item) != napi_ok ||
        read_input(env, item, false, false, &value) != 0) { free(handle_scratch); return NULL; }
    size_t item_length = value.length;
    size_t required = packed + 4 + item_length;
    if (required > INT_MAX) {
      free(value.data); free(handle_scratch);
      return throw_error(env, "handle batch exceeds the 2 GiB ABI limit");
    }
    if (required > capacity) {
      capacity = required > capacity * 2 ? required : capacity * 2;
      char* next = (char*)realloc(handle_scratch, capacity);
      if (!next) { free(value.data); free(handle_scratch); return throw_error(env, "out of memory"); }
      handle_scratch = next;
    }
    handle_scratch[packed] = (char)item_length;
    handle_scratch[packed + 1] = (char)(item_length >> 8);
    handle_scratch[packed + 2] = (char)(item_length >> 16);
    handle_scratch[packed + 3] = (char)(item_length >> 24);
    packed += 4;
    memcpy(handle_scratch + packed, value.data, item_length);
    free(value.data);
    packed += item_length;
  }
  if (napi_get_typedarray_info(env, argv[1], &handle_type, &handle_length, &handle_data, &handle_buffer, &handle_offset) != napi_ok ||
      napi_get_typedarray_info(env, argv[2], &field_type, &field_length, &field_data, &field_buffer, &field_offset) != napi_ok ||
      handle_length != count || field_length != count || (count && (!handle_data || !field_data))) {
    free(handle_scratch);
    return throw_error(env, "handle IDs changed during batch construction");
  }
  int status = pcgoHandleApplyPatchesV2_1(
      session,
      (unsigned int*)handle_data,
      (int*)field_data,
      (int)count,
      handle_scratch,
      (int)packed,
      &error);
  free(handle_scratch);
  if (status < 0) return throw_handle_error(env, &error);
  return NULL;
}

static int read_handle_stringify(uint32_t session, uint32_t handle, char** out, size_t* out_length, pcgoHandleError* error) {
  int capacity = MINIMUM_OUTPUT_CAPACITY;
  char* buffer = NULL;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      return -1;
    }
    buffer = next;
    int written = pcgoHandleStringifyV2_1(session, handle, buffer, capacity, error);
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
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 2;
  napi_value argv[2] = {0};
  uint32_t handle = 0;
  napi_value result;
  char* css = NULL;
  size_t length = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &handle) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_stringify(session, handle, &css, &length, &error) != 0) {
    return throw_handle_error(env, &error);
  }
  if (napi_create_string_utf8(env, css, length, &result) != napi_ok) {
    free(css);
    return NULL;
  }
  free(css);
  return result;
}

static napi_value handle_new_decl(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  input prop = {0}, value = {0};
  napi_value result;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_input(env, argv[1], false, false, &prop) != 0) return NULL;
  if (read_input(env, argv[2], false, false, &value) != 0) { free(prop.data); return NULL; }
  uint32_t handle = pcgoHandleNewDeclV2_1(session, prop.data, (int)prop.length, value.data, (int)value.length, &error);
  free(prop.data); free(value.data);
  if (handle == 0) return throw_handle_error(env, &error);
  if (napi_create_uint32(env, handle, &result) != napi_ok) return NULL;
  return result;
}

static napi_value handle_append(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 3;
  napi_value argv[3] = {0};
  uint32_t parent = 0;
  uint32_t child = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &parent) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[2], &child) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (pcgoHandleAppendV2_1(session, parent, child, &error) < 0) return throw_handle_error(env, &error);
  return NULL;
}

static napi_value handle_dispose(napi_env env, napi_callback_info info) {
  pcgoHandleError error = {0};
  uint32_t session = 0;
  size_t argc = 2;
  napi_value argv[2] = {0};
  uint32_t handle = 0;

  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[0], &session) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (read_handle_id(env, argv[1], &handle) != napi_ok) return throw_error(env, "invalid handle arguments");
  if (pcgoHandleDisposeV2_1(session, handle, &error) < 0) return throw_handle_error(env, &error);
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
      {"handleProtocolInfo", handle_protocol_info},
      {"handleParseV2", handle_parse},
      {"handleCloseV2", handle_close},
      {"handleTypeV2", handle_type},
      {"handleGetFieldV2", handle_get_field},
      {"handleSetFieldV2", handle_set_field},
      {"handleWalkDeclsV2", handle_walk_decls},
      {"handleOpenCursorV2", handle_open_cursor},
      {"handleCursorNextV2", handle_cursor_next},
      {"handleCloseCursorV2", handle_close_cursor},
      {"handleReadFieldsV2", handle_read_fields},
      {"handleReadSnapshotsV2", handle_read_snapshots},
      {"handleSetFieldsV2", handle_set_fields},
      {"handleApplyPatchesV2", handle_apply_patches},
      {"handleStringifyV2", handle_stringify},
      {"handleNewDeclV2", handle_new_decl},
      {"handleAppendV2", handle_append},
      {"handleDisposeV2", handle_dispose},
  };
  for (size_t i = 0; i < sizeof(handle_bindings) / sizeof(handle_bindings[0]); i++) {
    if (register_handle_binding(env, exports, handle_bindings[i].name, handle_bindings[i].fn) != 0) {
      return NULL;
    }
  }
  return exports;
}
