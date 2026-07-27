/*
 * Node-API bindings for the postcss-go native archive.
 *
 * parse returns a binary AST Buffer. stringify accepts that Buffer and returns
 * a small JSON object for css/map. process/noWork keep JSON for maps/messages
 * but process embeds the AST as a binary Buffer field instead of a DTO tree.
 */
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
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "go-out/libpostcssgo.h"

#define CHECK(expr)                     \
  do {                                  \
    if ((expr) != napi_ok) return NULL; \
  } while (0)

static napi_value ThrowLastError(napi_env env) {
  char message[4096];
  int length = pcgoLastError(message, (int)sizeof(message) - 1);
  if (length < 0) length = 0;
  if (length >= (int)sizeof(message)) length = (int)sizeof(message) - 1;
  message[length] = '\0';
  napi_throw_error(env, NULL, length > 0 ? message : "postcss-go native error");
  return NULL;
}

static int read_string_arg(napi_env env, napi_value value, char** out, size_t* out_len) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return -1;
  char* buffer = (char*)malloc(length + 1);
  if (!buffer) return -1;
  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) != napi_ok) {
    free(buffer);
    return -1;
  }
  *out = buffer;
  *out_len = length;
  return 0;
}

static napi_value call_with_growable_buffer(
    napi_env env,
    int (*fn)(char*, int, char*, int, char*, int),
    char* a, int a_len,
    char* b, int b_len) {
  int capacity = 1 << 20;
  char* buffer = NULL;
  int written = 0;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      napi_throw_error(env, NULL, "out of memory");
      return NULL;
    }
    buffer = next;
    written = fn(a, a_len, b, b_len, buffer, capacity);
    if (written < 0) {
      free(buffer);
      return ThrowLastError(env);
    }
    if (written <= capacity) break;
    capacity = written;
  }

  void* copy = NULL;
  napi_value result;
  if (napi_create_buffer_copy(env, (size_t)written, buffer, &copy, &result) != napi_ok) {
    free(buffer);
    return NULL;
  }
  free(buffer);
  return result;
}

static napi_value Parse(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "parse(css, from?)");
    return NULL;
  }

  char* css = NULL;
  size_t css_len = 0;
  if (read_string_arg(env, argv[0], &css, &css_len) != 0) return NULL;

  char* from = NULL;
  size_t from_len = 0;
  if (argc >= 2) {
    napi_valuetype type;
    CHECK(napi_typeof(env, argv[1], &type));
    if (type == napi_string) {
      if (read_string_arg(env, argv[1], &from, &from_len) != 0) {
        free(css);
        return NULL;
      }
    }
  }

  int capacity = 1 << 20;
  char* buffer = NULL;
  int written = 0;
  for (;;) {
    char* next = (char*)realloc(buffer, (size_t)capacity);
    if (!next) {
      free(buffer);
      free(css);
      free(from);
      napi_throw_error(env, NULL, "out of memory");
      return NULL;
    }
    buffer = next;
    written = pcgoParse(css, (int)css_len, from, (int)from_len, buffer, capacity);
    if (written < 0) {
      free(buffer);
      free(css);
      free(from);
      return ThrowLastError(env);
    }
    if (written <= capacity) break;
    capacity = written;
  }

  void* copy = NULL;
  napi_value result;
  napi_status status = napi_create_buffer_copy(env, (size_t)written, buffer, &copy, &result);
  free(buffer);
  free(css);
  free(from);
  if (status != napi_ok) return NULL;
  return result;
}

static napi_value Stringify(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "stringify(astBuffer, optionsJson?)");
    return NULL;
  }

  void* data = NULL;
  size_t length = 0;
  bool is_buffer = false;
  CHECK(napi_is_buffer(env, argv[0], &is_buffer));
  if (!is_buffer) {
    napi_throw_type_error(env, NULL, "stringify expects a Buffer");
    return NULL;
  }
  CHECK(napi_get_buffer_info(env, argv[0], &data, &length));

  char* options = NULL;
  size_t options_len = 0;
  if (argc >= 2) {
    napi_valuetype type;
    CHECK(napi_typeof(env, argv[1], &type));
    if (type == napi_string) {
      if (read_string_arg(env, argv[1], &options, &options_len) != 0) return NULL;
    }
  }

  napi_value result = call_with_growable_buffer(
      env, pcgoStringify, (char*)data, (int)length, options, (int)options_len);
  free(options);
  if (!result) return NULL;

  /* stringify returns JSON bytes; decode to a JS string for the caller. */
  void* json_data = NULL;
  size_t json_len = 0;
  CHECK(napi_get_buffer_info(env, result, &json_data, &json_len));
  napi_value text;
  CHECK(napi_create_string_utf8(env, (char*)json_data, json_len, &text));
  return text;
}

static napi_value Process(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "process(css, optionsJson?)");
    return NULL;
  }

  char* css = NULL;
  size_t css_len = 0;
  if (read_string_arg(env, argv[0], &css, &css_len) != 0) return NULL;

  char* options = NULL;
  size_t options_len = 0;
  if (argc >= 2) {
    napi_valuetype type;
    CHECK(napi_typeof(env, argv[1], &type));
    if (type == napi_string) {
      if (read_string_arg(env, argv[1], &options, &options_len) != 0) {
        free(css);
        return NULL;
      }
    }
  }

  napi_value result = call_with_growable_buffer(
      env, pcgoProcess, css, (int)css_len, options, (int)options_len);
  free(css);
  free(options);
  if (!result) return NULL;

  void* json_data = NULL;
  size_t json_len = 0;
  CHECK(napi_get_buffer_info(env, result, &json_data, &json_len));
  napi_value text;
  CHECK(napi_create_string_utf8(env, (char*)json_data, json_len, &text));
  return text;
}

static napi_value NoWork(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "noWork(css, optionsJson?)");
    return NULL;
  }

  char* css = NULL;
  size_t css_len = 0;
  if (read_string_arg(env, argv[0], &css, &css_len) != 0) return NULL;

  char* options = NULL;
  size_t options_len = 0;
  if (argc >= 2) {
    napi_valuetype type;
    CHECK(napi_typeof(env, argv[1], &type));
    if (type == napi_string) {
      if (read_string_arg(env, argv[1], &options, &options_len) != 0) {
        free(css);
        return NULL;
      }
    }
  }

  napi_value result = call_with_growable_buffer(
      env, pcgoNoWork, css, (int)css_len, options, (int)options_len);
  free(css);
  free(options);
  if (!result) return NULL;

  void* json_data = NULL;
  size_t json_len = 0;
  CHECK(napi_get_buffer_info(env, result, &json_data, &json_len));
  napi_value text;
  CHECK(napi_create_string_utf8(env, (char*)json_data, json_len, &text));
  return text;
}

NAPI_MODULE_INIT() {
  const struct {
    const char* name;
    napi_callback fn;
  } bindings[] = {
      {"parse", Parse},
      {"stringify", Stringify},
      {"process", Process},
      {"noWork", NoWork},
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
