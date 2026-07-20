import path from 'node:path';

import postcss, { type AcceptedPlugin, type Result, type SourceMap } from 'postcss';

import getMapfile, { type MapOptions, type ProcessFileOptions } from './getMapfile.js';
import { createNodeService, type NodePostcssGoService } from './node.js';
import { resolveGoBridgeServiceOptions } from './resolveGoBridge.js';
import type { ProcessResult as BridgeProcessResult } from './types.js';

export interface CliConfig {
  options?: ProcessFileOptions;
  map?: boolean | MapOptions;
  plugins?: AcceptedPlugin[] | Record<string, unknown>;
}

export interface GoEngine {
  name: 'go';
  queue: Promise<unknown>;
  service: Pick<NodePostcssGoService, 'process' | 'close'>;
  close(): Promise<void>;
}

export interface CliMessage {
  type?: string;
  text?: string;
  parent?: string;
  file?: string;
  dir?: string;
  glob?: string;
  toString?: () => string;
  // Bridge and third-party message shapes vary; keep this bag flexible.
  [key: string]: unknown;
}

export interface CliProcessResult {
  css: string;
  map?: string | SourceMap;
  mapFile?: string;
  messages: CliMessage[];
  warnings(): CliMessage[];
}

export function getEffectiveMapOption(config?: CliConfig): boolean | MapOptions | undefined {
  if (config?.options?.map !== undefined) {
    return config.options.map;
  }

  return config?.map;
}

export function isSourceMapEnabled(map: boolean | MapOptions | undefined): boolean {
  return map !== false && map !== undefined;
}

export function isExternalSourceMap(map: boolean | MapOptions | undefined): boolean {
  if (!isSourceMapEnabled(map)) return false;
  if (map === true) return false;
  return (map as MapOptions).inline !== true;
}

export function assertGoCompatibility(
  argv: { parser?: string; syntax?: string; stringifier?: string },
  config?: CliConfig,
): boolean {
  return !hasCustomSyntax({
    parser: argv.parser,
    syntax: argv.syntax,
    stringifier: argv.stringifier,
    ...(config?.options ?? {}),
  });
}

export function createGoEngine(): GoEngine {
  return {
    name: 'go',
    queue: Promise.resolve(),
    service: createNodeService(resolveGoBridgeServiceOptions()),
    async close() {
      await this.service.close();
    },
  };
}

export async function processWithGoEngine(
  engine: GoEngine,
  config: CliConfig | undefined,
  css: string | Buffer,
  options: ProcessFileOptions,
): Promise<CliProcessResult> {
  const run = async (): Promise<CliProcessResult> => {
    const inputCss = typeof css === 'string' ? css : css.toString('utf8');
    if (hasCustomSyntax(options)) {
      return processWithPostcss(config, inputCss, options);
    }
    const mapEnabled = isSourceMapEnabled(options.map);
    const shouldRunPostcss = hasPlugins(config?.plugins) || mapEnabled;
    const mapOption = options.map && typeof options.map === 'object' ? options.map : {};
    const pluginMap =
      options.map && typeof options.map === 'object'
        ? { ...options.map, inline: false, annotation: false }
        : { inline: false, annotation: false };
    const pluginResult = shouldRunPostcss
      ? await runPluginChain(config, inputCss, {
          ...options,
          map: mapEnabled ? pluginMap : false,
        })
      : null;
    const resolvedAnnotation =
      typeof mapOption.annotation === 'function'
        ? mapOption.annotation(options.to, pluginResult?.root)
        : mapOption.annotation;
    const mapFile = mapEnabled ? getSourceMapFile(options, resolvedAnnotation) : undefined;
    const processOptions: Record<string, unknown> = { from: options.from };
    if (options.to) processOptions.to = options.to;
    if (mapEnabled) {
      processOptions.map = true;
      processOptions.mapFile = mapFile;
      processOptions.absolute = mapOption.absolute === true;
      processOptions.preserveAnnotation = mapOption.annotation === false;
      processOptions.sourceMapFrom = mapOption.from;
      if (mapOption.sourcesContent !== undefined) {
        processOptions.sourcesContent = mapOption.sourcesContent;
      }
      if (pluginResult?.map) {
        processOptions.previousMap = pluginResult.map.toString();
        processOptions.previousMapUrl = toSourceMapPath(
          `${options.to || options.from || 'to.css'}.map`,
        );
      }
    }
    const result = (await engine.service.process(
      pluginResult?.css ?? inputCss,
      // Bridge accepts a wider option set than the public ProcessOptions surface.
      processOptions as Parameters<NodePostcssGoService['process']>[1],
    )) as BridgeProcessResult;
    const messages: CliMessage[] = [
      ...((pluginResult?.messages ?? []) as CliMessage[]),
      ...((result.messages ?? []) as CliMessage[]),
    ];
    const annotated = applySourceMapAnnotation(result.css, result.map, options, resolvedAnnotation);

    return {
      css: annotated.css,
      map: annotated.map,
      mapFile: isExternalSourceMap(options.map) ? mapFile : undefined,
      warnings() {
        return messages
          .filter((message) => message.type === 'warning')
          .map((warning) => ({
            ...warning,
            toString() {
              if (
                typeof warning.toString === 'function' &&
                warning.toString !== Object.prototype.toString
              ) {
                return warning.toString();
              }
              return typeof warning.text === 'string' ? warning.text : String(warning);
            },
          }));
      },
      messages,
    };
  };

  const next = engine.queue.then(run);
  engine.queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function processWithPostcss(
  config: CliConfig | undefined,
  css: string,
  options: ProcessFileOptions,
): Promise<CliProcessResult> {
  const result = await runPluginChain(config, css, options);
  return {
    css: result.css,
    map: result.map,
    mapFile: isExternalSourceMap(options.map) ? getSourceMapFile(options) : undefined,
    warnings() {
      return result.warnings() as unknown as CliMessage[];
    },
    messages: result.messages as unknown as CliMessage[],
  };
}

export function runPluginChain(
  config: CliConfig | undefined,
  css: string,
  options: ProcessFileOptions,
): Promise<Result> {
  const plugins = Array.isArray(config?.plugins)
    ? config.plugins
    : ((config?.plugins ? Object.values(config.plugins) : []) as AcceptedPlugin[]);
  return postcss(plugins).process(css, options as postcss.ProcessOptions);
}

function hasPlugins(plugins: CliConfig['plugins']): boolean {
  if (!plugins) return false;
  if (Array.isArray(plugins)) return plugins.length > 0;
  return Object.keys(plugins).length > 0;
}

function hasCustomSyntax(options?: ProcessFileOptions): boolean {
  return Boolean(options?.parser || options?.syntax || options?.stringifier);
}

function applySourceMapAnnotation(
  css: string,
  map: string | undefined,
  options: ProcessFileOptions,
  resolvedAnnotation: boolean | string | undefined,
): { css: string; map: string | undefined } {
  if (!map || !isSourceMapEnabled(options.map)) {
    return { css, map: undefined };
  }

  const mapOption = options.map && typeof options.map === 'object' ? options.map : {};

  if (options.map === true || mapOption.inline === true) {
    const encoded = Buffer.from(map).toString('base64');
    return {
      css: `${css}\n/*# sourceMappingURL=data:application/json;base64,${encoded} */`,
      map: undefined,
    };
  }

  if (mapOption.annotation === false) {
    return { css, map };
  }

  const annotation =
    typeof resolvedAnnotation === 'string'
      ? resolvedAnnotation
      : path.basename(getMapfile(options));
  return {
    css: `${css}\n/*# sourceMappingURL=${annotation} */`,
    map,
  };
}

function getSourceMapFile(
  options: ProcessFileOptions,
  resolvedAnnotation?: boolean | string,
): string {
  if (!isExternalSourceMap(options.map)) {
    return options.to || options.from || 'to.css';
  }
  if (typeof resolvedAnnotation === 'string') {
    return path.resolve(path.dirname(options.to ?? ''), resolvedAnnotation);
  }
  return getMapfile(options);
}

function toSourceMapPath(value: string): string {
  return value.replaceAll('\\', '/');
}
