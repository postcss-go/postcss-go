import path from 'node:path';

import {
  applyMapAnnotationAsync,
  isExternalSourceMap,
  isSourceMapEnabled,
  mapDefersInlineMode,
  type MapOptions,
  type ProcessFileOptions,
} from '@postcss-go/shared/map-options';
import { getMapfile, joinMapAnnotationPath, toSourceMapPath } from '@postcss-go/shared/map-path';
import { createNativeService, isNativeBridgeAvailable } from './native.js';
import { createNodeService, type NodePostcssGoService } from './node.js';
import { runPluginsWithBridge, type PluginResult } from './plugin-runtime.js';
import type { AcceptedPlugin } from './plugin-types.js';
import { resolveGoBridgeServiceOptions } from './resolve-go-bridge.js';
import type { ProcessOptions, SourceMapOptions } from './types.js';
import { UnsupportedSyntaxError } from './errors.js';
import { assertSupportedSyntax, hasUnsupportedSyntax } from './syntax-options.js';

export interface CliConfig {
  options?: ProcessFileOptions;
  map?: boolean | MapOptions;
  plugins?: AcceptedPlugin[] | Record<string, unknown>;
}

export interface GoEngine {
  name: 'go';
  queue: Promise<unknown>;
  service: Pick<
    NodePostcssGoService,
    'process' | 'noWork' | 'parse' | 'stringify' | 'stringifyResult' | 'close'
  >;
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
  map?: string | { toString(): string };
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
  return !hasUnsupportedSyntax({
    parser: argv.parser,
    syntax: argv.syntax,
    stringifier: argv.stringifier,
    ...(config?.options ?? {}),
  });
}

export function createGoEngine(): GoEngine {
  const preferChild =
    process.env.POSTCSS_GO_BRIDGE === 'child' || process.env.POSTCSS_GO_BRIDGE === 'stdio';
  const service =
    !preferChild && isNativeBridgeAvailable()
      ? createNativeService()
      : createNodeService(resolveGoBridgeServiceOptions());
  return {
    name: 'go',
    queue: Promise.resolve(),
    service,
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
    assertSupportedSyntax(options);
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
      ? await runPluginChain(
          config,
          inputCss,
          {
            ...options,
            map: mapEnabled ? pluginMap : false,
          },
          engine.service,
        )
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
    const optionsForService = await applyMapAnnotationAsync(options, annotationRoot);
    const mapForServiceBase = optionsForService.map as ProcessOptions['map'];
    const resolvedAnnotation =
      mapForServiceBase && typeof mapForServiceBase === 'object'
        ? mapForServiceBase.annotation
        : undefined;

    // Keep public PostCSS-shaped options here. Node/browser services own
    // normalizeProcessOptions at the bridge boundary.
    let mapForService: ProcessOptions['map'] = mapForServiceBase;

    if (
      pluginResult &&
      mapEnabled &&
      mapDefersInlineMode(mapForService as MapOptions | boolean | undefined)
    ) {
      const inputMap = (
        (pluginResult.root.source as unknown as { input?: unknown } | undefined)?.input as
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

export function runPluginChain(
  config: CliConfig | undefined,
  css: string,
  options: ProcessFileOptions,
  service?: Pick<
    NodePostcssGoService,
    'parse' | 'process' | 'stringify' | 'stringifyResult' | 'close'
  >,
): Promise<PluginResult> {
  return runWithPluginService(service, getPlugins(config), css, options);
}

async function runWithPluginService(
  service:
    | Pick<NodePostcssGoService, 'parse' | 'process' | 'stringify' | 'stringifyResult' | 'close'>
    | undefined,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
): Promise<PluginResult> {
  const activeService = service ?? createNodeService(resolveGoBridgeServiceOptions());
  try {
    return await runPluginsWithBridge(activeService, plugins, css, options);
  } finally {
    if (!service) await activeService.close();
  }
}

function getPlugins(config: CliConfig | undefined): AcceptedPlugin[] {
  return Array.isArray(config?.plugins)
    ? config.plugins
    : ((config?.plugins ? Object.values(config.plugins) : []) as AcceptedPlugin[]);
}

function hasPlugins(plugins: CliConfig['plugins']): boolean {
  if (!plugins) return false;
  if (Array.isArray(plugins)) return plugins.length > 0;
  return Object.keys(plugins).length > 0;
}

export { UnsupportedSyntaxError };

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
