import { InvalidPluginError, UnsupportedPluginFeatureError } from './errors.js';

const SYNTAX_AS_PLUGIN_MESSAGE =
  'PostCSS syntaxes cannot be used as plugins. Instead, please use one of the syntax/parser/stringifier options as outlined in your PostCSS runner documentation.';

export function isSyntaxAsPlugin(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    postcssPlugin?: unknown;
    plugins?: unknown;
    parse?: unknown;
    stringify?: unknown;
  };
  if (candidate.postcssPlugin || Array.isArray(candidate.plugins)) return false;
  return typeof candidate.parse === 'function' || typeof candidate.stringify === 'function';
}

/** Reject syntax objects and other non-plugin values with a stable diagnostic. */
export function throwInvalidPlugin(value: unknown): never {
  if (isSyntaxAsPlugin(value)) {
    throw new UnsupportedPluginFeatureError(
      'PostCSS syntax objects as plugins',
      SYNTAX_AS_PLUGIN_MESSAGE,
    );
  }
  throw new InvalidPluginError(value);
}
