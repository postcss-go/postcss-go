export type MapOptions = {
  absolute?: boolean;
  annotation?: boolean | string | ((file?: string, root?: unknown) => string | Promise<string>);
  from?: string;
  inline?: boolean;
  prev?: unknown;
  sourcesContent?: boolean;
};

export type NormalizeProcessOptionsInput = {
  from?: string;
  to?: string;
  map?: boolean | MapOptions;
  mapAuto?: boolean;
  mapFile?: string;
  previousMap?: string;
  previousMapPath?: string;
  previousMapUrl?: string;
  previousMapDisabled?: boolean;
  sourceMapFrom?: string;
  sourcesContent?: boolean;
  absolute?: boolean;
  preserveAnnotation?: boolean;
  mapInline?: boolean;
  mapInlineAuto?: boolean;
  mapAnnotation?: string;
  mapAnnotationDefault?: boolean;
  mapAnnotationDisabled?: boolean;
};

export type ProcessFileOptions = {
  from?: string;
  to?: string;
  map?: boolean | MapOptions;
  parser?: unknown;
  syntax?: unknown;
  stringifier?: unknown;
  [key: string]: unknown;
};

export type ResolveAnnotationPath = (to: string | undefined, annotation: string) => string;

/** Materialize `map.annotation` callbacks into a concrete string. */
export function applyMapAnnotation<T extends { to?: string; map?: unknown }>(
  options: T,
  root?: unknown,
): T {
  const map = options.map;
  if (!map || typeof map !== 'object' || typeof (map as MapOptions).annotation !== 'function') {
    return options;
  }
  const mapOptions = map as MapOptions;
  const callback = mapOptions.annotation as (
    file?: string,
    root?: unknown,
  ) => string | Promise<string>;
  const annotation = callback(options.to, root);
  if (isThenable(annotation)) {
    void Promise.resolve(annotation).catch(() => undefined);
    throw new Error('map.annotation returned a Promise during synchronous annotation resolution');
  }
  return {
    ...options,
    map: {
      ...mapOptions,
      annotation,
    },
  };
}

/** Materialize synchronous or asynchronous `map.annotation` callbacks. */
export async function applyMapAnnotationAsync<T extends { to?: string; map?: unknown }>(
  options: T,
  root?: unknown,
): Promise<T> {
  const map = options.map;
  if (!map || typeof map !== 'object' || typeof (map as MapOptions).annotation !== 'function') {
    return options;
  }
  const mapOptions = map as MapOptions;
  const callback = mapOptions.annotation as (
    file?: string,
    root?: unknown,
  ) => string | Promise<string>;
  const annotation = await callback(options.to, root);
  return {
    ...options,
    map: {
      ...mapOptions,
      annotation,
    },
  };
}

export function isSourceMapEnabled(map: boolean | MapOptions | undefined): boolean {
  return map !== false && map !== undefined;
}

export function isExternalSourceMap(map: boolean | MapOptions | undefined): boolean {
  if (map === false || map === undefined || map === true) return false;
  if (map.inline !== undefined) return map.inline === false;
  if (map.annotation !== undefined && map.annotation !== true) return true;
  return false;
}

/** True when PostCSS/Go should still decide inline vs external from previous maps. */
export function mapDefersInlineMode(map: boolean | MapOptions | undefined): boolean {
  if (map === false || map === true) return false;
  if (map === undefined) return true;
  if (map.inline !== undefined) return false;
  if (map.annotation !== undefined && map.annotation !== true) return false;
  return true;
}

export function normalizeProcessOptions(
  options: NormalizeProcessOptionsInput,
  resolveAnnotationPath?: ResolveAnnotationPath,
): NormalizeProcessOptionsInput {
  if (options.map === false) return options;
  if (options.map === undefined) {
    return {
      ...options,
      mapAuto: true,
      mapInlineAuto: true,
    };
  }
  if (options.map === true) {
    if (hasFlatMapOutputOptions(options)) return options;
    return {
      ...options,
      map: true,
      mapInline: true,
      mapAnnotationDisabled: true,
    };
  }

  const mapOptions = options.map;
  const bridgeOptions: NormalizeProcessOptionsInput = {
    ...options,
    map: true,
  };
  if (mapOptions.absolute !== undefined) bridgeOptions.absolute = mapOptions.absolute;
  if (mapOptions.annotation === false) bridgeOptions.preserveAnnotation = true;
  if (mapOptions.from !== undefined) bridgeOptions.sourceMapFrom = mapOptions.from;
  if (mapOptions.sourcesContent !== undefined) {
    bridgeOptions.sourcesContent = mapOptions.sourcesContent;
  }
  const previous =
    typeof mapOptions.prev === 'function' ? mapOptions.prev(options.from) : mapOptions.prev;
  if (previous === false) bridgeOptions.previousMapDisabled = true;
  else if (typeof previous === 'string') {
    if (typeof mapOptions.prev === 'function') bridgeOptions.previousMapPath = previous;
    else bridgeOptions.previousMap = previous;
  } else if (previous) {
    bridgeOptions.previousMap = serializePreviousMap(previous);
  }
  if (
    (bridgeOptions.previousMap || bridgeOptions.previousMapPath) &&
    !bridgeOptions.previousMapUrl
  ) {
    bridgeOptions.previousMapUrl = `${options.from ?? options.to ?? 'to.css'}.map`;
  }
  if (
    !bridgeOptions.mapFile &&
    typeof mapOptions.annotation === 'string' &&
    resolveAnnotationPath
  ) {
    bridgeOptions.mapFile = resolveAnnotationPath(options.to, mapOptions.annotation);
  }

  if (mapOptions.inline !== undefined) {
    bridgeOptions.mapInline = mapOptions.inline;
    if (mapOptions.inline || mapOptions.annotation === false) {
      bridgeOptions.mapAnnotationDisabled = true;
    } else if (typeof mapOptions.annotation !== 'string') {
      bridgeOptions.mapAnnotationDefault = true;
      bridgeOptions.mapAnnotationDisabled = false;
    }
  } else if (mapOptions.annotation !== undefined && mapOptions.annotation !== true) {
    bridgeOptions.mapAnnotationDisabled = mapOptions.annotation === false;
  } else {
    bridgeOptions.mapInlineAuto = true;
  }

  if (typeof mapOptions.annotation === 'string') {
    bridgeOptions.mapAnnotation = mapOptions.annotation;
    bridgeOptions.mapAnnotationDisabled = false;
  }
  return bridgeOptions;
}

/** Evaluate `map.prev` exactly once at the JavaScript boundary. */
export function materializePreviousMap<T extends { from?: string; map?: unknown }>(options: T): T {
  const map = options.map;
  if (!map || typeof map !== 'object') return options;
  const mapOptions = map as MapOptions;
  if (typeof mapOptions.prev === 'function') {
    const prev = mapOptions.prev(options.from);
    assertSyncPreviousMap(prev);
    return {
      ...options,
      map: {
        ...mapOptions,
        prev,
      },
    };
  }
  assertSyncPreviousMap(mapOptions.prev);
  return options;
}

function assertSyncPreviousMap(prev: unknown): void {
  if (!isThenable(prev)) return;
  void Promise.resolve(prev).catch(() => undefined);
  throw new Error(
    'map.prev returned a Promise; resolve the previous map before calling postcss-go',
  );
}

function serializePreviousMap(previous: unknown): string {
  if (!previous || typeof previous !== 'object') {
    throw new Error(`Unsupported previous source map format: ${String(previous)}`);
  }

  const toJSON = (previous as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return assertPreviousMapText(JSON.stringify(toJSON.call(previous)));
  }

  if (isIndexedSourceMapConsumerLike(previous)) {
    return assertPreviousMapText(
      JSON.stringify({
        version: 3,
        sections: previous._sections.map((section) => ({
          offset: {
            line: section.generatedOffset.generatedLine - 1,
            column: section.generatedOffset.generatedColumn - 1,
          },
          map: JSON.parse(serializePreviousMap(section.consumer)),
        })),
      }),
    );
  }

  if (isSourceMapConsumerLike(previous)) {
    const consumer = previous as SourceMapConsumerLike;
    return assertPreviousMapText(
      JSON.stringify({
        version: 3,
        sources: collectionToArray(consumer._sources) ?? [...consumer.sources],
        names: collectionToArray(consumer._names) ?? [],
        mappings: consumer._mappings,
        ...(consumer.file ? { file: consumer.file } : {}),
        ...(consumer.sourceRoot ? { sourceRoot: consumer.sourceRoot } : {}),
        ...(consumer.sourcesContent ? { sourcesContent: [...consumer.sourcesContent] } : {}),
      }),
    );
  }

  const text = String(previous);
  if (text !== '[object Object]') {
    try {
      return assertPreviousMapText(text);
    } catch {
      // Fall through to JSON serialization for map-like objects.
    }
  }
  return assertPreviousMapText(JSON.stringify(previous));
}

type SourceMapConsumerLike = {
  sources: readonly string[];
  sourcesContent?: readonly string[] | null;
  file?: string | null;
  sourceRoot?: string | null;
  _mappings: string;
  _sources?: { toArray?: () => string[] };
  _names?: { toArray?: () => string[] };
  originalPositionFor: (...args: any[]) => unknown;
};

type IndexedSourceMapConsumerLike = {
  _sections: Array<{
    generatedOffset: { generatedLine: number; generatedColumn: number };
    consumer: object;
  }>;
  originalPositionFor: (...args: any[]) => unknown;
};

function isIndexedSourceMapConsumerLike(value: object): value is IndexedSourceMapConsumerLike {
  const candidate = value as Partial<IndexedSourceMapConsumerLike>;
  return Array.isArray(candidate._sections) && typeof candidate.originalPositionFor === 'function';
}

function isSourceMapConsumerLike(value: object): value is SourceMapConsumerLike {
  const candidate = value as Partial<SourceMapConsumerLike>;
  return (
    Array.isArray(candidate.sources) &&
    typeof candidate._mappings === 'string' &&
    typeof candidate.originalPositionFor === 'function'
  );
}

function collectionToArray(collection: { toArray?: () => string[] } | undefined) {
  return typeof collection?.toArray === 'function' ? collection.toArray() : undefined;
}

function assertPreviousMapText(text: string | undefined): string {
  if (!text) throw new Error('Unsupported previous source map format');
  let parsed: { mappings?: unknown; sections?: unknown };
  try {
    parsed = JSON.parse(text) as { mappings?: unknown; sections?: unknown };
  } catch {
    throw new Error('Previous source map is not valid JSON');
  }
  if (typeof parsed.mappings !== 'string' && !Array.isArray(parsed.sections)) {
    throw new Error('Unsupported previous source map format');
  }
  return text;
}

function hasFlatMapOutputOptions(options: NormalizeProcessOptionsInput): boolean {
  return (
    options.mapInline !== undefined ||
    options.mapInlineAuto !== undefined ||
    options.mapAnnotation !== undefined ||
    options.mapAnnotationDefault !== undefined ||
    options.mapAnnotationDisabled !== undefined
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
