import path from 'node:path';

import {
  applyMapAnnotation,
  isExternalSourceMap,
  isSourceMapEnabled,
  mapDefersInlineMode,
  type MapOptions,
  type ProcessFileOptions,
} from '@postcss-go/shared/map-options';
import { getMapfile, joinMapAnnotationPath, toSourceMapPath } from '@postcss-go/shared/map-path';
import postcss, { type AcceptedPlugin, type Result, type SourceMap } from 'postcss';

import { createNodeService, type NodePostcssGoService } from './node.js';
import { resolveGoBridgeServiceOptions } from './resolveGoBridge.js';
import type { ProcessOptions, SourceMapOptions } from './types.js';

export interface CliConfig {
  options?: ProcessFileOptions;
  map?: boolean | MapOptions;
  plugins?: AcceptedPlugin[] | Record<string, unknown>;
}

export interface GoEngine {
  name: 'go';
  queue: Promise<unknown>;
  service: Pick<NodePostcssGoService, 'process' | 'noWork' | 'parse' | 'close'>;
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

export { isExternalSourceMap, isSourceMapEnabled };

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
    // With no plugins, sending the input straight to Go avoids PostCSS's
    // NoWorkResult/MapGenerator path. Go owns the complete no-work map flow.
    const shouldRunPostcss = hasPlugins(config?.plugins);
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
    let annotationRoot: unknown = pluginResult?.root;
    if (!annotationRoot && typeof mapOption.annotation === 'function') {
      // Dynamic annotations are the one JS callback boundary. Parsing here
      // supplies its root without invoking PostCSS's no-work result path.
      if (typeof engine.service.parse !== 'function') {
        throw new Error('Go engine parse() is required for map.annotation callbacks');
      }
      const parsed = await engine.service.parse(inputCss, { from: options.from });
      annotationRoot = parsed.root;
    }
    const optionsForService = applyMapAnnotation(options, annotationRoot);
    const mapForServiceBase = optionsForService.map as ProcessOptions['map'];
    const resolvedAnnotation =
      mapForServiceBase && typeof mapForServiceBase === 'object'
        ? mapForServiceBase.annotation
        : undefined;

    // Keep public PostCSS-shaped options here. Node/browser services own
    // normalizeProcessOptions at the bridge boundary.
    let mapForService: ProcessOptions['map'] = mapForServiceBase;

    if (pluginResult && mapEnabled && mapDefersInlineMode(mapForService as MapOptions | boolean | undefined)) {
      const inputMap = (
        pluginResult.root.source?.input as unknown as
          | {
              map?: { inline?: boolean; text?: string };
            }
          | undefined
      )?.map;
      const base =
        mapForService && typeof mapForService === 'object'
          ? mapForService
          : ({} as SourceMapOptions);
      mapForService = {
        ...base,
        inline: !inputMap || inputMap.inline === true,
      };
    }

    const publicOptions: ProcessOptions = { from: options.from };
    if (options.to !== undefined) publicOptions.to = options.to;
    if (mapForService !== undefined) publicOptions.map = mapForService;

    if (pluginResult?.map) {
      if (publicOptions.map && typeof publicOptions.map === 'object') {
        const { prev: _ignored, ...rest } = publicOptions.map;
        publicOptions.map = rest;
      }
      publicOptions.previousMap = pluginResult.map.toString();
      publicOptions.previousMapUrl = toSourceMapPath(
        `${options.to || options.from || 'to.css'}.map`,
      );
    }

    const processedCss = pluginResult?.css ?? inputCss;
    const result = shouldRunPostcss
      ? await engine.service.process(processedCss, publicOptions)
      : await engine.service.noWork(processedCss, publicOptions);

    const messages: CliMessage[] = [
      ...((pluginResult?.messages ?? []) as CliMessage[]),
      ...(('messages' in result ? result.messages : []) as CliMessage[]),
    ];
    // Annotation/inline comments are applied by Go when map options are set.
    const map = result.map ? result.map : undefined;
    const outputMapFile = result.map
      ? getSourceMapFile(
          options,
          typeof resolvedAnnotation === 'string' ? resolvedAnnotation : undefined,
          true,
        )
      : undefined;

    return {
      css: result.css,
      map,
      mapFile: outputMapFile,
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
  if (!options) return false;

  // Explicit references to PostCSS's defaults do not change AST or output
  // semantics and should not force the whole pipeline onto the fallback.
  if (options.parser && options.parser !== postcss.parse) return true;
  if (options.stringifier && options.stringifier !== postcss.stringify) return true;
  if (options.syntax && !isDefaultSyntax(options.syntax)) return true;
  return false;
}

function isDefaultSyntax(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const syntax = value as { parse?: unknown; stringify?: unknown };
  return syntax.parse === postcss.parse && syntax.stringify === postcss.stringify;
}

function getSourceMapFile(
  options: ProcessFileOptions,
  resolvedAnnotation?: boolean | string,
  external = isExternalSourceMap(options.map),
): string {
  if (!external) {
    return options.to || options.from || 'to.css';
  }
  if (typeof resolvedAnnotation === 'string') {
    return path.resolve(joinMapAnnotationPath(options.to, resolvedAnnotation));
  }
  return getMapfile(options);
}
