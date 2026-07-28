import type { AstStringifyResult, ProcessOptions } from './types.js';

type MapOutputOptions = {
  from?: string;
  to?: string;
  map?:
    | boolean
    | {
        annotation?: unknown;
        inline?: boolean;
      };
};

type SourceBearingNode = {
  source?: {
    input?: {
      map?: {
        inline?: boolean;
      };
    };
  };
};

/** Avoid enabling map-auto for a plain stringify with no previous map. */
export function prepareStringifyOptions(
  node: SourceBearingNode,
  options: ProcessOptions,
): ProcessOptions {
  const previousInline = previousMapInline(node);
  if (options.map === undefined) {
    return previousInline === undefined
      ? { ...options, map: false }
      : { ...options, map: { inline: previousInline } };
  }
  if (
    options.map &&
    typeof options.map === 'object' &&
    options.map.inline === undefined &&
    options.map.annotation !== false &&
    typeof options.map.annotation !== 'string' &&
    previousInline !== undefined
  ) {
    return { ...options, map: { ...options.map, inline: previousInline } };
  }
  return options;
}

/** Apply PostCSS-shaped inline/external annotation semantics to a Go map result. */
export function finalizeStringifyResult(
  result: AstStringifyResult,
  options: MapOutputOptions,
  node: SourceBearingNode,
): AstStringifyResult {
  if (!result.map || options.map === false || options.map === undefined) return result;

  const inline = shouldInline(options, node);
  if (inline) {
    return {
      css: appendAnnotation(result.css, inlineMapUrl(result.map)),
    };
  }

  const map = options.map;
  if (typeof map === 'object' && map.annotation === false) return result;
  const annotation =
    typeof map === 'object' && typeof map.annotation === 'string'
      ? map.annotation
      : defaultAnnotation(options);
  return {
    ...result,
    css: appendAnnotation(result.css, annotation),
  };
}

function shouldInline(options: MapOutputOptions, node: SourceBearingNode): boolean {
  if (options.map === true) return true;
  const map = options.map;
  if (!map || typeof map !== 'object') return false;
  if (map.inline !== undefined) return map.inline;
  if (map.annotation === false || typeof map.annotation === 'string') return false;
  return previousMapInline(node) !== false;
}

function previousMapInline(node: SourceBearingNode): boolean | undefined {
  return node.source?.input?.map?.inline;
}

function defaultAnnotation(options: MapOutputOptions): string {
  const output = options.to ?? options.from ?? 'to.css';
  const basename = output.replaceAll('\\', '/').split('/').at(-1) || 'to.css';
  return `${basename}.map`;
}

function inlineMapUrl(map: string): string {
  return `data:application/json;base64,${encodeBase64(map)}`;
}

function appendAnnotation(css: string, annotation: string): string {
  const separator = css.endsWith('\n') || css.length === 0 ? '' : '\n';
  return `${css}${separator}/*# sourceMappingURL=${annotation} */`;
}

function encodeBase64(text: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new TextEncoder().encode(text);
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(value >> 18) & 63];
    encoded += alphabet[(value >> 12) & 63];
    encoded += second === undefined ? '=' : alphabet[(value >> 6) & 63];
    encoded += third === undefined ? '=' : alphabet[value & 63];
  }
  return encoded;
}
