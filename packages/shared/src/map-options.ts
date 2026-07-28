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
    const text = String(previous);
    bridgeOptions.previousMap =
      (text.startsWith('{') || text.startsWith('[')) && text !== '[object Object]'
        ? text
        : JSON.stringify(previous);
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
