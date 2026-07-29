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
