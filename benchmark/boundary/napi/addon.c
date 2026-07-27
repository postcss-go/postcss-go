/*
 * Minimal Node-API shim over the Go c-archive. Each binding is deliberately as
 * thin as possible so the measured time is the boundary cost itself rather
 * than anything this layer adds.
 */
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#include "libcore.h"

#define SCRATCH_CAPACITY (1 << 20)
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

NAPI_MODULE_INIT() {
  const struct {
    const char* name;
    napi_callback fn;
  } bindings[] = {
      {"nativeNoop", NativeNoop},   {"cgoNoop", CgoNoop},
      {"cgoAddInt", CgoAddInt},     {"cgoGetProp", CgoGetProp},
      {"cgoSetValue", CgoSetValue}, {"cgoGetPropsBatch", CgoGetPropsBatch},
      {"initArena", InitArena},
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
