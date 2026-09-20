import {
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import type { ProcessOptions } from './types.js';

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

function previousMapInline(node: SourceBearingNode): boolean | undefined {
  return node.source?.input?.map?.inline;
}

function utf8ToBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mapFileBasename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** Attach sourceMappingURL comments and choose inline vs external map payloads. */
export function finalizeMappedCSS(
  css: string,
  map: string | undefined,
  options: ProcessOptions,
): { css: string; map?: string; mapFile?: string } {
  if (!map) return { css };
  const normalized = normalizeProcessOptions(
    options as NormalizeProcessOptionsInput,
    joinMapAnnotationPath,
  );
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  if (normalized.mapInline) {
    return {
      css: `${css}${eol}/*# sourceMappingURL=data:application/json;base64,${utf8ToBase64(map)} */`,
    };
  }
  let next = css;
  if (!normalized.mapAnnotationDisabled) {
    const mapFile = normalized.mapFile || `${normalized.to || normalized.from || 'to.css'}.map`;
    const annotation =
      normalized.mapAnnotation || (normalized.mapAnnotationDefault ? mapFileBasename(mapFile) : '');
    if (annotation) next = `${next}${eol}/*# sourceMappingURL=${annotation} */`;
    return { css: next, map, mapFile };
  }
  return {
    css: next,
    map,
    mapFile: normalized.mapFile || `${normalized.to || normalized.from || 'to.css'}.map`,
  };
}
