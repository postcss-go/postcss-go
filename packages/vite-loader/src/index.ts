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
import type { Plugin, ResolvedConfig } from 'vite';

export interface PostcssGoVitePluginApi {
  mode: string;
  env: string;
  file: string;
  viteConfig: ResolvedConfig;
  options: PostcssGoVitePluginOptions;
}

export interface PostcssGoViteProcessOptions extends ProcessFileOptions {
  /** Search for a postcss-go config, use an explicit config path, or disable config loading. */
  config?: boolean | string;
  /** Instantiated PostCSS-compatible plugins. */
  plugins?: AcceptedPlugin[];
}

export interface PostcssGoVitePluginOptions {
  /** Enable source-map output. Defaults to Vite's CSS source-map setting. */
  sourceMap?: boolean;
  /** Processing options or a per-resource options factory. */
  postcssOptions?:
    | PostcssGoViteProcessOptions
    | ((
        api: PostcssGoVitePluginApi,
      ) => PostcssGoViteProcessOptions | Promise<PostcssGoViteProcessOptions>);
}

type SourceMapJson = Record<string, unknown> & {
  file?: string;
  sourceRoot?: string;
};

const CSS_REQUEST = /\.(?:css|pcss|postcss)$/i;

export default function postcssGoVitePlugin(options: PostcssGoVitePluginOptions = {}): Plugin {
  let viteConfig: ResolvedConfig;

  return {
    name: 'postcss-go:vite-loader',
    enforce: 'pre',

    config(config) {
      // Vite otherwise discovers the same postcss.config.* after this hook and
      // runs its plugins a second time. Preserve an explicit Vite PostCSS setup.
      if (config.css?.postcss !== undefined) return;
      return { css: { postcss: { plugins: [] } } };
    },

    configResolved(config) {
      viteConfig = config;
    },

    async transform(content, id) {
      const file = cleanRequestId(id);
      if (!file || !CSS_REQUEST.test(file)) return null;

      const configured = await resolvePluginOptions(options, viteConfig, file);
      const { plugins, processOptions, configFile } = await resolveProcessConfiguration(
        options,
        configured,
        viteConfig,
        file,
      );
      if (configFile) this.addWatchFile(configFile);

      const useSourceMap = resolveSourceMap(options, viteConfig);
      configureSourceMap(processOptions, useSourceMap);

      try {
        const result = await postcssGo(plugins).process(content, processOptions);
        emitWarnings(this, result.warnings(), file);
        emitMessages(this, result.messages);

        const map = useSourceMap
          ? normalizeOutputSourceMap(result.map?.toJSON() as SourceMapJson | undefined)
          : undefined;
        return { code: result.css, map: map ? JSON.stringify(map) : null };
      } catch (error) {
        if (error instanceof CssSyntaxError) {
          this.error({
            message: formatSyntaxError(error),
            id: error.file ?? file,
            loc:
              error.line === undefined
                ? undefined
                : { line: error.line, column: Math.max(0, (error.column ?? 1) - 1) },
            frame: error.showSourceCode() || undefined,
          });
        }
        throw error;
      }
    },
  };
}

function cleanRequestId(id: string): string {
  if (id.startsWith('\0')) return '';
  const queryIndex = id.search(/[?#]/);
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

async function resolvePluginOptions(
  options: PostcssGoVitePluginOptions,
  viteConfig: ResolvedConfig,
  file: string,
): Promise<PostcssGoViteProcessOptions> {
  const configured = options.postcssOptions;
  if (typeof configured !== 'function') return configured ?? {};
  const mode = resolveMode(viteConfig);
  return await configured({
    mode,
    env: mode,
    file,
    viteConfig,
    options,
  });
}

async function resolveProcessConfiguration(
  pluginOptions: PostcssGoVitePluginOptions,
  configured: PostcssGoViteProcessOptions,
  viteConfig: ResolvedConfig,
  file: string,
): Promise<{
  plugins: AcceptedPlugin[];
  processOptions: ProcessFileOptions;
  configFile?: string;
}> {
  const { config = true, plugins: directPlugins = [], ...directOptions } = configured;
  if (!Array.isArray(directPlugins)) {
    throw new TypeError(
      '@postcss-go/vite-loader requires postcssOptions.plugins to be an array of instantiated plugins',
    );
  }

  let configFile: string | undefined;
  let configPlugins: AcceptedPlugin[] = [];
  let configOptions: ProcessFileOptions = {};
  if (config !== false) {
    const fileDirectory = path.dirname(file);
    const searchFrom =
      typeof config === 'string' ? path.resolve(viteConfig.root, config) : fileDirectory;
    const loaded = await loadConfig(
      {
        env: resolveMode(viteConfig),
        cwd: viteConfig.root,
        file: {
          dirname: fileDirectory,
          basename: path.basename(file),
          extname: path.extname(file),
        },
        options: directOptions,
        viteConfig,
        vitePluginOptions: pluginOptions,
      },
      searchFrom,
    );
    if (!loaded && typeof config === 'string') {
      throw new Error(`No postcss-go config found at ${searchFrom}`);
    }
    if (loaded) {
      configFile = loaded.file;
      configPlugins = loaded.plugins;
      configOptions = loaded.options;
    }
  }

  const processOptions: ProcessFileOptions = {
    map: false,
    ...configOptions,
    ...directOptions,
    // Vite module identity and its source-map chain use the real request path.
    from: file,
    to: file,
  };
  if (processOptions.map === true) {
    processOptions.map = { inline: true };
  }

  return {
    plugins: configPlugins.length === 0 ? directPlugins : [...configPlugins, ...directPlugins],
    processOptions,
    configFile,
  };
}

function resolveMode(config: ResolvedConfig): string {
  return config.mode ?? process.env.NODE_ENV ?? 'development';
}

function resolveSourceMap(options: PostcssGoVitePluginOptions, config: ResolvedConfig): boolean {
  if (options.sourceMap !== undefined) return options.sourceMap;
  return config.command === 'serve' ? config.css.devSourcemap : Boolean(config.build.sourcemap);
}

function configureSourceMap(processOptions: ProcessFileOptions, enabled: boolean): void {
  if (!enabled) {
    processOptions.map = false;
    return;
  }
  const configuredMap =
    processOptions.map && typeof processOptions.map === 'object'
      ? (processOptions.map as SourceMapOptions)
      : undefined;
  processOptions.map = {
    ...configuredMap,
    inline: false,
    annotation: false,
  };
}

function normalizeOutputSourceMap(map: SourceMapJson | undefined): SourceMapJson | undefined {
  if (!map) return undefined;
  delete map.file;
  map.sourceRoot = '';
  return map;
}

interface ViteTransformContext {
  addWatchFile(file: string): void;
  emitFile(asset: {
    type: 'asset';
    fileName?: string;
    name?: string;
    source: string | Uint8Array;
  }): string;
  warn(warning: { message: string; id?: string; loc?: { line: number; column: number } }): void;
}

function emitWarnings(context: ViteTransformContext, warnings: Warning[], file: string): void {
  for (const warning of warnings) {
    context.warn({
      message: warning.plugin ? `[${warning.plugin}] ${warning.text}` : warning.text,
      id: file,
      loc:
        warning.line === undefined
          ? undefined
          : { line: warning.line, column: Math.max(0, (warning.column ?? 1) - 1) },
    });
  }
}

function emitMessages(context: ViteTransformContext, messages: ResultMessage[]): void {
  for (const message of messages) {
    switch (message.type) {
      case 'dependency':
      case 'build-dependency':
      case 'missing-dependency':
      case 'context-dependency':
        if (typeof message.file === 'string') context.addWatchFile(message.file);
        break;
      case 'dir-dependency':
        if (typeof message.dir === 'string') context.addWatchFile(message.dir);
        break;
      case 'asset':
        if (
          typeof message.file === 'string' &&
          (typeof message.content === 'string' || Buffer.isBuffer(message.content))
        ) {
          context.emitFile({
            type: 'asset',
            fileName: message.file,
            source: message.content,
          });
        }
        break;
    }
  }
}

function formatSyntaxError(error: CssSyntaxError): string {
  return `${error.plugin ? `[${error.plugin}] ` : ''}${error.reason}`;
}
