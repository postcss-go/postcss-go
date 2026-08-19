/*
 * Minimal Node-API shim over the Go c-archive. Each binding is deliberately as
 * thin as possible so the measured time is the boundary cost itself rather
 * than anything this layer adds.
 */
#if defined(__has_include)
#  if __has_include(<node_api.h>)
#    include <node_api.h>
#  elif __has_include("../../../packages/postcss-go/node_modules/node-api-headers/include/node_api.h")
#    include "../../../packages/postcss-go/node_modules/node-api-headers/include/node_api.h"
#  else
#    error "node_api.h not found; run pnpm install or build via node-gyp"
#  endif
#else
#  include <node_api.h>
#endif
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if defined(__has_include)
#  if __has_include("libcore.h")
#    include "libcore.h"
#  elif __has_include("go-out/libcore.h")
#    include "go-out/libcore.h"
#  else
#    error "libcore.h not found; build the Go c-archive first"
#  endif
#else
#  include "libcore.h"
#endif

#define SCRATCH_CAPACITY (8 << 20)
static char scratch[SCRATCH_CAPACITY];

#define CHECK(expr)                     \
  do {                                  \
    if ((expr) != napi_ok) return NULL; \
  } while (0)

/* Pure NAPI dispatch with no cgo transition, to isolate the two costs. */
static napi_value NativeNoop(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  return NULL;
}

static napi_value CgoNoop(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  pcgoNoop();
  return NULL;
}

static napi_value CgoAddInt(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t a = 0, b = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &a));
  CHECK(napi_get_value_int32(env, argv[1], &b));
  CHECK(napi_create_int32(env, pcgoAddInt(a, b), &result));
  return result;
}

/* The realistic "read decl.prop" path: Go copies out, NAPI makes a JS string. */
static napi_value CgoGetProp(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t handle = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &handle));

  int length = pcgoGetProp(handle, scratch, SCRATCH_CAPACITY);
  if (length < 0) {
    napi_throw_error(env, NULL, "invalid handle");
    return NULL;
  }
  CHECK(napi_create_string_utf8(env, scratch, (size_t)length, &result));
  return result;
}

/* The realistic "decl.value = x" path. */
static napi_value CgoSetValue(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t handle = 0;
  size_t length = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &handle));
  CHECK(napi_get_value_string_utf8(env, argv[1], scratch, SCRATCH_CAPACITY, &length));

  pcgoSetValue(handle, scratch, (int)length);
  return NULL;
}

/* Batched read: one crossing yields `count` prop/value pairs as JS strings. */
static napi_value CgoGetPropsBatch(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t start = 0, count = 0;
  napi_value array;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &start));
  CHECK(napi_get_value_int32(env, argv[1], &count));

  int written = pcgoGetPropsBatch(start, count, scratch, SCRATCH_CAPACITY);
  if (written < 0) {
    napi_throw_error(env, NULL, "scratch overflow");
    return NULL;
  }

  CHECK(napi_create_array(env, &array));
  int offset = 0;
  uint32_t index = 0;
  while (offset + 4 <= written) {
    uint32_t length = (uint32_t)(unsigned char)scratch[offset] |
                      ((uint32_t)(unsigned char)scratch[offset + 1] << 8) |
                      ((uint32_t)(unsigned char)scratch[offset + 2] << 16) |
                      ((uint32_t)(unsigned char)scratch[offset + 3] << 24);
    offset += 4;
    if (offset + (int)length > written) break;

    napi_value item;
    CHECK(napi_create_string_utf8(env, scratch + offset, length, &item));
    CHECK(napi_set_element(env, array, index++, item));
    offset += (int)length;
  }
  return array;
}

static napi_value InitArena(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t count = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &count));
  pcgoInitArena(count);
  return NULL;
}

static napi_value HandleParse(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  size_t length = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_string_utf8(env, argv[0], NULL, 0, &length));
  char* css = (char*)malloc(length + 1);
  if (css == NULL) {
    napi_throw_error(env, NULL, "handle parse alloc failed");
    return NULL;
  }
  CHECK(napi_get_value_string_utf8(env, argv[0], css, length + 1, &length));
  uint32_t handle = pcgoHandleParse(css, (int)length);
  free(css);
  if (handle == 0) {
    napi_throw_error(env, NULL, "handle parse failed");
    return NULL;
  }
  CHECK(napi_create_uint32(env, handle, &result));
  return result;
}

static napi_value HandleClose(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  pcgoHandleClose();
  return NULL;
}

static napi_value HandleType(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &handle));
  CHECK(napi_create_int32(env, pcgoHandleType(handle), &result));
  return result;
}

static napi_value HandleGetField(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t handle = 0;
  int32_t field = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &handle));
  CHECK(napi_get_value_int32(env, argv[1], &field));
  int length = pcgoHandleGetField(handle, field, scratch, SCRATCH_CAPACITY);
  if (length < 0) {
    napi_throw_error(env, NULL, "handle getField failed");
    return NULL;
  }
  CHECK(napi_create_string_utf8(env, scratch, (size_t)length, &result));
  return result;
}

static napi_value HandleSetField(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  uint32_t handle = 0;
  int32_t field = 0;
  size_t length = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &handle));
  CHECK(napi_get_value_int32(env, argv[1], &field));
  CHECK(napi_get_value_string_utf8(env, argv[2], scratch, SCRATCH_CAPACITY, &length));
  if (pcgoHandleSetField(handle, field, scratch, (int)length) < 0) {
    napi_throw_error(env, NULL, "handle setField failed");
    return NULL;
  }
  return NULL;
}

static napi_value HandleWalkDecls(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t root = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &root));
  CHECK(napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset));
  if (type != napi_uint32_array) {
    napi_throw_type_error(env, NULL, "expected Uint32Array");
    return NULL;
  }
  int count = pcgoHandleWalkDecls(root, (unsigned int*)data, (int)length);
  if (count < 0) {
    napi_throw_error(env, NULL, "handle walkDecls failed");
    return NULL;
  }
  CHECK(napi_create_int32(env, count, &result));
  return result;
}

static napi_value HandleOpenCursor(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t root = 0;
  bool decls_only = true;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &root));
  if (argc > 1) CHECK(napi_get_value_bool(env, argv[1], &decls_only));
  int id = pcgoHandleOpenCursor(root, decls_only ? 1 : 0);
  if (id < 0) {
    napi_throw_error(env, NULL, "handle openCursor failed");
    return NULL;
  }
  CHECK(napi_create_int32(env, id, &result));
  return result;
}

static napi_value HandleCursorNext(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  int32_t id = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &id));
  CHECK(napi_get_typedarray_info(env, argv[1], &type, &length, &data, &arraybuffer, &offset));
  int count = pcgoHandleCursorNext(id, (unsigned int*)data, (int)length);
  if (count < 0) {
    napi_throw_error(env, NULL, "handle cursorNext failed");
    return NULL;
  }
  CHECK(napi_create_int32(env, count, &result));
  return result;
}

static napi_value HandleCloseCursor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t id = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_int32(env, argv[0], &id));
  pcgoHandleCloseCursor(id);
  return NULL;
}

static napi_value HandleReadFields(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  napi_value array;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_typedarray_info(env, argv[0], &type, &length, &data, &arraybuffer, &offset));
  CHECK(napi_get_value_int32(env, argv[1], &field));
  int written = pcgoHandleReadFields((unsigned int*)data, (int)length, field, scratch, SCRATCH_CAPACITY);
  if (written < 0) {
    napi_throw_error(env, NULL, "handle readFields failed");
    return NULL;
  }
  CHECK(napi_create_array(env, &array));
  int cursor = 0;
  uint32_t index = 0;
  while (cursor + 4 <= written) {
    uint32_t size = (uint32_t)(unsigned char)scratch[cursor] |
                    ((uint32_t)(unsigned char)scratch[cursor + 1] << 8) |
                    ((uint32_t)(unsigned char)scratch[cursor + 2] << 16) |
                    ((uint32_t)(unsigned char)scratch[cursor + 3] << 24);
    cursor += 4;
    napi_value item;
    CHECK(napi_create_string_utf8(env, scratch + cursor, size, &item));
    CHECK(napi_set_element(env, array, index++, item));
    cursor += (int)size;
  }
  return array;
}

static napi_value HandleSetFields(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_typedarray_type type;
  size_t length = 0;
  void* data = NULL;
  napi_value arraybuffer;
  size_t offset = 0;
  int32_t field = 0;
  uint32_t count = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_typedarray_info(env, argv[0], &type, &length, &data, &arraybuffer, &offset));
  CHECK(napi_get_value_int32(env, argv[1], &field));
  CHECK(napi_get_array_length(env, argv[2], &count));

  int packed = 0;
  for (uint32_t i = 0; i < count; i++) {
    napi_value item;
    size_t item_length = 0;
    CHECK(napi_get_element(env, argv[2], i, &item));
    CHECK(napi_get_value_string_utf8(env, item, NULL, 0, &item_length));
    if (packed + 4 + (int)item_length > SCRATCH_CAPACITY) {
      napi_throw_error(env, NULL, "handle setFields overflow");
      return NULL;
    }
    scratch[packed] = (char)item_length;
    scratch[packed + 1] = (char)(item_length >> 8);
    scratch[packed + 2] = (char)(item_length >> 16);
    scratch[packed + 3] = (char)(item_length >> 24);
    packed += 4;
    CHECK(napi_get_value_string_utf8(env, item, scratch + packed, SCRATCH_CAPACITY - packed, &item_length));
    packed += (int)item_length;
  }
  if (pcgoHandleSetFields((unsigned int*)data, (int)length, field, scratch, packed) < 0) {
    napi_throw_error(env, NULL, "handle setFields failed");
    return NULL;
  }
  return NULL;
}

static napi_value HandleStringify(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &handle));
  int length = pcgoHandleStringify(handle, scratch, SCRATCH_CAPACITY);
  if (length < 0) {
    napi_throw_error(env, NULL, "handle stringify failed");
    return NULL;
  }
  CHECK(napi_create_string_utf8(env, scratch, (size_t)length, &result));
  return result;
}

static napi_value HandleNewDecl(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  size_t prop_len = 0;
  size_t value_len = 0;
  napi_value result;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_string_utf8(env, argv[0], scratch, SCRATCH_CAPACITY / 2, &prop_len));
  CHECK(napi_get_value_string_utf8(env, argv[1], scratch + (SCRATCH_CAPACITY / 2), SCRATCH_CAPACITY / 2, &value_len));
  uint32_t handle = pcgoHandleNewDecl(scratch, (int)prop_len, scratch + (SCRATCH_CAPACITY / 2), (int)value_len);
  if (handle == 0) {
    napi_throw_error(env, NULL, "handle newDecl failed");
    return NULL;
  }
  CHECK(napi_create_uint32(env, handle, &result));
  return result;
}

static napi_value HandleAppend(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  uint32_t parent = 0;
  uint32_t child = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &parent));
  CHECK(napi_get_value_uint32(env, argv[1], &child));
  if (pcgoHandleAppend(parent, child) < 0) {
    napi_throw_error(env, NULL, "handle append failed");
    return NULL;
  }
  return NULL;
}

static napi_value HandleDispose(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t handle = 0;

  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &handle));
  if (pcgoHandleDispose(handle) < 0) {
    napi_throw_error(env, NULL, "handle dispose failed");
    return NULL;
  }
  return NULL;
}

NAPI_MODULE_INIT() {
  const struct {
    const char* name;
    napi_callback fn;
  } bindings[] = {
      {"nativeNoop", NativeNoop},
      {"cgoNoop", CgoNoop},
      {"cgoAddInt", CgoAddInt},
      {"cgoGetProp", CgoGetProp},
      {"cgoSetValue", CgoSetValue},
      {"cgoGetPropsBatch", CgoGetPropsBatch},
      {"initArena", InitArena},
      {"handleParse", HandleParse},
      {"handleClose", HandleClose},
      {"handleType", HandleType},
      {"handleGetField", HandleGetField},
      {"handleSetField", HandleSetField},
      {"handleWalkDecls", HandleWalkDecls},
      {"handleOpenCursor", HandleOpenCursor},
      {"handleCursorNext", HandleCursorNext},
      {"handleCloseCursor", HandleCloseCursor},
      {"handleReadFields", HandleReadFields},
      {"handleSetFields", HandleSetFields},
      {"handleStringify", HandleStringify},
      {"handleNewDecl", HandleNewDecl},
      {"handleAppend", HandleAppend},
      {"handleDispose", HandleDispose},
  };

  for (size_t i = 0; i < sizeof(bindings) / sizeof(bindings[0]); i++) {
    napi_value fn;
    if (napi_create_function(env, bindings[i].name, NAPI_AUTO_LENGTH, bindings[i].fn, NULL, &fn) !=
        napi_ok) {
      return NULL;
    }
    if (napi_set_named_property(env, exports, bindings[i].name, fn) != napi_ok) {
      return NULL;
    }
  }
  return exports;
}
