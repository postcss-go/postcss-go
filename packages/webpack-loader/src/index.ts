import path from 'node:path';

import postcssGo, {
  CssSyntaxError,
  loadConfig,
  type AcceptedPlugin,
  type ProcessFileOptions,
  type ResultMessage,
  type SourceMapOptions,
  type Warning,
} from '@postcss-go/core';
import type { LoaderContext, LoaderDefinitionFunction } from 'webpack';

export interface PostcssGoLoaderApi {
  mode: string;
  file: string;
  webpackLoaderContext: LoaderContext<PostcssGoLoaderOptions>;
  env: string;
  options: PostcssGoLoaderOptions;
}

export interface PostcssGoLoaderProcessOptions extends ProcessFileOptions {
  /** Search for a postcss-go config, use an explicit config path, or disable config loading. */
  config?: boolean | string;
  /** Instantiated PostCSS-compatible plugins. */
  plugins?: AcceptedPlugin[];
}

export interface PostcssGoLoaderOptions {
  /** Enable source-map output. Defaults to Webpack's loader source-map setting. */
  sourceMap?: boolean;
  /** Processing options or a per-resource options factory. */
  postcssOptions?:
    | PostcssGoLoaderProcessOptions
    | ((
        api: PostcssGoLoaderApi,
      ) => PostcssGoLoaderProcessOptions | Promise<PostcssGoLoaderProcessOptions>);
}

type SourceMapJson = Record<string, unknown> & {
  file?: string;
  sourceRoot?: string;
  sources?: unknown;
};

const ABSOLUTE_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const NATIVE_WIN32_PATH = /^[a-z]:[/\\]|^\\\\/i;
const XSSI_PREFIX = /^\)]}'[^\n]*\n/;

const loader: LoaderDefinitionFunction<PostcssGoLoaderOptions> = function postcssGoLoader(
  content,
  sourceMap,
) {
  this.cacheable?.();
  const callback = this.async();

  void runLoader(this, content, sourceMap).then(
    ({ css, map, meta }) => callback(null, css, map as never, meta as never),
    (error: unknown) => {
      if (error instanceof CssSyntaxError && error.file) {
        this.addDependency(error.file);
      }
      callback(formatLoaderError(error));
    },
  );
};

export default loader;

async function runLoader(
  loaderContext: LoaderContext<PostcssGoLoaderOptions>,
  content: string | Buffer,
  sourceMap: string | object | undefined,
): Promise<{
  css: string;
  map: SourceMapJson | undefined;
  meta: { ast: { type: string; version: string; root: unknown } };
}> {
  const loaderOptions = loaderContext.getOptions();
  const configured = await resolveLoaderOptions(loaderContext, loaderOptions);
  const { plugins, processOptions } = await resolveProcessConfiguration(loaderContext, configured);
  const useSourceMap = loaderOptions.sourceMap ?? loaderContext.sourceMap ?? false;
  const resourceContext = resolveResourceContext(loaderContext);
  configureSourceMap(processOptions, useSourceMap, sourceMap, resourceContext);

  const result = await postcssGo(plugins).process(String(content), processOptions);
  emitWarnings(loaderContext, result.warnings());
  emitMessages(loaderContext, result.messages);

  let outputMap = result.map?.toJSON() as SourceMapJson | undefined;
  if (outputMap && useSourceMap) {
    outputMap = normalizeOutputSourceMap(outputMap, resourceContext);
  }

  return {
    css: result.css,
    map: outputMap,
    meta: {
      ast: {
        type: 'postcss',
        version: result.processor.version ?? '',
        root: result.root,
      },
    },
  };
}

async function resolveLoaderOptions(
  loaderContext: LoaderContext<PostcssGoLoaderOptions>,
  loaderOptions: PostcssGoLoaderOptions,
): Promise<PostcssGoLoaderProcessOptions> {
  const configured = loaderOptions.postcssOptions;
  if (typeof configured !== 'function') return configured ?? {};

  const mode = resolveMode(loaderContext);
  return await configured({
    mode,
    env: mode,
    file: loaderContext.resourcePath,
    webpackLoaderContext: loaderContext,
    options: loaderOptions,
  });
}

async function resolveProcessConfiguration(
  loaderContext: LoaderContext<PostcssGoLoaderOptions>,
  configured: PostcssGoLoaderProcessOptions,
): Promise<{ plugins: AcceptedPlugin[]; processOptions: ProcessFileOptions }> {
  const { config = true, plugins: directPlugins = [], ...directOptions } = configured;
  if (!Array.isArray(directPlugins)) {
    throw new TypeError(
      '@postcss-go/webpack-loader requires postcssOptions.plugins to be an array of instantiated plugins',
    );
  }

  let configPlugins: AcceptedPlugin[] = [];
  let configOptions: ProcessFileOptions = {};

  if (config !== false) {
    const resourceDir = path.dirname(loaderContext.resourcePath);
    const searchFrom =
      typeof config === 'string' ? path.resolve(loaderContext.rootContext, config) : resourceDir;
    const loaded = await loadConfig(
      {
        env: resolveMode(loaderContext),
        cwd: loaderContext.rootContext,
        file: {
          dirname: resourceDir,
          basename: path.basename(loaderContext.resourcePath),
          extname: path.extname(loaderContext.resourcePath),
        },
        options: directOptions,
        webpackLoaderContext: loaderContext,
      },
      searchFrom,
    );
    if (!loaded && typeof config === 'string') {
      throw new Error(`No postcss-go config found at ${searchFrom}`);
    }
    if (loaded) {
      loaderContext.addBuildDependency(loaded.file);
      loaderContext.addDependency(loaded.file);
      configPlugins = loaded.plugins;
      configOptions = loaded.options;
    }
  }

  const processOptions: ProcessFileOptions = {
    map: false,
    ...configOptions,
    ...directOptions,
    // Webpack module identity and watch graph use the real resource path.
    // Config / options must not redirect `from` / `to` away from it.
    from: loaderContext.resourcePath,
    to: loaderContext.resourcePath,
  };
  if (processOptions.map === true) {
    processOptions.map = { inline: true };
  }

  return {
    plugins: configPlugins.length === 0 ? directPlugins : [...configPlugins, ...directPlugins],
    processOptions,
  };
}

function configureSourceMap(
  processOptions: ProcessFileOptions,
  enabled: boolean,
  sourceMap: string | object | undefined,
  resourceContext: string,
): void {
  if (!enabled) {
    // Webpack is not consuming maps; do not leave config `map: true` inline
    // annotations in the CSS that downstream loaders receive.
    processOptions.map = false;
    return;
  }

  const configuredMap =
    processOptions.map && typeof processOptions.map === 'object'
      ? (processOptions.map as SourceMapOptions)
      : undefined;

  // Webpack consumes the map via the loader callback; keep CSS free of
  // inline annotations even if config set `map: true` / `inline: true`.
  processOptions.map = {
    ...configuredMap,
    inline: false,
    annotation: false,
  };

  if (sourceMap) {
    processOptions.map.prev = normalizeInputSourceMap(sourceMap, resourceContext);
  }
}

function normalizeInputSourceMap(
  sourceMap: string | object,
  resourceContext: string,
): SourceMapJson {
  const normalized: SourceMapJson =
    typeof sourceMap === 'string'
      ? (JSON.parse(sourceMap.replace(XSSI_PREFIX, '')) as SourceMapJson)
      : { ...(sourceMap as SourceMapJson) };

  delete normalized.file;
  const sourceRoot = typeof normalized.sourceRoot === 'string' ? normalized.sourceRoot : undefined;
  delete normalized.sourceRoot;

  if (Array.isArray(normalized.sources)) {
    normalized.sources = normalized.sources.map((source) => {
      if (typeof source !== 'string') return source;
      const sourceType = getSourceUrlType(source);
      if (sourceType === 'scheme-relative' || sourceType === 'absolute') return source;

      const absolute =
        sourceType === 'path-relative' && sourceRoot
          ? path.resolve(sourceRoot, path.normalize(source))
          : path.normalize(source);
      return path.relative(resourceContext, absolute);
    });
  }

  return normalized;
}

function normalizeOutputSourceMap(map: SourceMapJson, resourceContext: string): SourceMapJson {
  delete map.file;
  map.sourceRoot = '';
  if (!Array.isArray(map.sources)) return map;

  map.sources = map.sources.map((source) => {
    if (typeof source !== 'string' || source.startsWith('<')) return source;
    return getSourceUrlType(source) === 'path-relative'
      ? path.resolve(resourceContext, source)
      : source;
  });
  return map;
}

type SourceUrlType = 'scheme-relative' | 'path-absolute' | 'absolute' | 'path-relative';

function getSourceUrlType(source: string): SourceUrlType {
  if (source.startsWith('//')) return 'scheme-relative';
  if (source.startsWith('/') || NATIVE_WIN32_PATH.test(source)) return 'path-absolute';
  return ABSOLUTE_SCHEME.test(source) ? 'absolute' : 'path-relative';
}

function emitWarnings(
  loaderContext: LoaderContext<PostcssGoLoaderOptions>,
  warnings: Warning[],
): void {
  for (const warning of warnings) {
    let message = formatLocation(warning.line, warning.column);
    if (warning.plugin) message += `from "${warning.plugin}" plugin: `;
    message += warning.text;
    if (warning.node) message += `\n\nCode:\n ${warning.node.toString()}\n`;
    loaderContext.emitWarning(errorWithoutStack(message, warning));
  }
}

function emitMessages(
  loaderContext: LoaderContext<PostcssGoLoaderOptions>,
  messages: ResultMessage[],
): void {
  for (const message of messages) {
    switch (message.type) {
      case 'dependency':
        if (typeof message.file === 'string') loaderContext.addDependency(message.file);
        break;
      case 'build-dependency':
        if (typeof message.file === 'string') loaderContext.addBuildDependency(message.file);
        break;
      case 'missing-dependency':
        if (typeof message.file === 'string') loaderContext.addMissingDependency(message.file);
        break;
      case 'context-dependency':
        if (typeof message.file === 'string') loaderContext.addContextDependency(message.file);
        break;
      case 'dir-dependency':
        if (typeof message.dir === 'string') loaderContext.addContextDependency(message.dir);
        break;
      case 'asset':
        if (
          typeof message.file === 'string' &&
          (typeof message.content === 'string' || Buffer.isBuffer(message.content))
        ) {
          loaderContext.emitFile(
            message.file,
            message.content,
            serializeSourceMap(message.sourceMap),
            isPlainObject(message.info) ? (message.info as never) : undefined,
          );
        }
        break;
    }
  }
}

function serializeSourceMap(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isPlainObject(value) ? JSON.stringify(value) : undefined;
}

function formatLoaderError(error: unknown): Error {
  if (!(error instanceof CssSyntaxError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  let message = `\nSyntaxError\n\n${formatLocation(error.line, error.column)}`;
  if (error.plugin) message += `from "${error.plugin}" plugin: `;
  message += error.file ? `${error.file} ` : ' ';
  message += error.reason;

  const sourceCode = error.showSourceCode();
  if (sourceCode) message += `\n\n${sourceCode}\n`;

  return errorWithoutStack(message, error);
}

function formatLocation(line?: number, column?: number): string {
  return line === undefined ? '' : `(${line}:${column ?? 1}) `;
}

function errorWithoutStack(message: string, cause: unknown): Error {
  const error = new Error(message, { cause });
  error.stack = '';
  return error;
}

function resolveMode(loaderContext: LoaderContext<PostcssGoLoaderOptions>): string {
  return loaderContext.mode ?? process.env.NODE_ENV ?? 'development';
}

function resolveResourceContext(loaderContext: LoaderContext<PostcssGoLoaderOptions>): string {
  return loaderContext.context ?? path.dirname(loaderContext.resourcePath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
