import {
  applyMapAnnotationAsync,
  type MapOptions,
  type ProcessFileOptions,
} from 'postcss-go-shared/map-options';
import { createDefaultAsyncService } from './native.js';
import { asProcessRoot, fromAst, type Node } from './ast.js';
import { attachInputMetadata } from './input.js';
import type { PluginResult } from './plugin-runtime.js';
import type { AcceptedPlugin } from './plugin-types.js';
import { dispatchProcess, prepareDispatchOptions } from './dispatch.js';
import type { PostcssGoService } from './service.js';
import type { BackendKind } from './service.js';
import type { ProcessOptions } from './types.js';
import { hasUnsupportedSyntax } from './syntax-options.js';

export interface CliConfig {
  options?: ProcessFileOptions;
  map?: boolean | MapOptions;
  /** Instantiated plugins only. Object module→options maps belong in `loadConfig`. */
  plugins?: AcceptedPlugin[];
}

export interface GoEngine {
  name: 'go';
  queue: Promise<unknown>;
  service: Pick<
    PostcssGoService,
    'process' | 'noWork' | 'parse' | 'stringify' | 'stringifyResult' | 'close'
  >;
  /** Backend selected for this reusable engine. */
  backend: BackendKind;
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
  /** Backend that performed this processing operation. */
  backend: BackendKind;
  warnings(): CliMessage[];
}

export function getEffectiveMapOption(config?: CliConfig): boolean | MapOptions | undefined {
  if (config?.options?.map !== undefined) {
    return config.options.map;
  }

  return config?.map;
}

/** Thin predicate for callers that need a boolean without throwing. */
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
  const service = createDefaultAsyncService();
  return {
    name: 'go',
    queue: Promise.resolve(),
    service,
    backend: service.capabilities?.backend ?? 'native',
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

    // Match Processor.process: plugins finalize CSS and maps via stringifyResult.
    if (hasPlugins(config?.plugins)) {
      const pluginResult = await dispatchProcess(
        engine.service,
        inputCss,
        options,
        getPlugins(config),
      );
      return toCliResult(
        pluginResult.css,
        pluginResult.map,
        pluginResult.mapFile,
        [...(pluginResult.messages as CliMessage[])],
        pluginResult.backend ?? engine.backend,
      );
    }

    options = prepareDispatchOptions(options);

    // No plugins: Go owns the complete no-work map flow.
    const mapOption = options.map && typeof options.map === 'object' ? options.map : {};
    let annotationRoot: Node | undefined;
    if (typeof mapOption.annotation === 'function') {
      // Dynamic annotations are the one JS callback boundary. Parsing here
      // supplies its root without invoking PostCSS's no-work result path.
      if (typeof engine.service.parse !== 'function') {
        throw new Error('Go engine parse() is required for map.annotation callbacks');
      }
      const parsed = await engine.service.parse(inputCss, { from: options.from });
      annotationRoot = asProcessRoot(fromAst(parsed.root));
      attachInputMetadata(annotationRoot, inputCss, options as ProcessOptions);
    }
    const optionsForService = await applyMapAnnotationAsync(options, annotationRoot);
    const publicOptions: ProcessOptions = { from: options.from };
    if (options.to !== undefined) publicOptions.to = options.to;
    if (optionsForService.map !== undefined) {
      // `ProcessFileOptions` deliberately accepts loader-facing map values
      // (`prev: unknown`). They have been materialized by this point, so the
      // bridge receives the narrower public service contract.
      publicOptions.map = optionsForService.map as ProcessOptions['map'];
    }

    const result = await engine.service.noWork(inputCss, publicOptions);
    const messages = (
      'messages' in result ? ((result as { messages?: CliMessage[] }).messages ?? []) : []
    ) as CliMessage[];
    return toCliResult(result.css, result.map, result.mapFile, messages, engine.backend);
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
  service?: Pick<PostcssGoService, 'parse' | 'process' | 'stringify' | 'stringifyResult' | 'close'>,
): Promise<PluginResult> {
  return runWithPluginService(service, getPlugins(config), css, options);
}

async function runWithPluginService(
  service:
    | Pick<PostcssGoService, 'parse' | 'process' | 'stringify' | 'stringifyResult' | 'close'>
    | undefined,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
): Promise<PluginResult> {
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchProcess(activeService, css, options, plugins);
  } finally {
    if (!service) await activeService.close();
  }
}

function toCliResult(
  css: string,
  map: string | { toString(): string } | undefined,
  mapFile: string | undefined,
  messages: CliMessage[],
  backend: BackendKind,
): CliProcessResult {
  const outputMap = map ? map : undefined;
  return {
    css,
    map: outputMap,
    mapFile: outputMap ? mapFile : undefined,
    backend,
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
}

function getPlugins(config: CliConfig | undefined): AcceptedPlugin[] {
  return config?.plugins ?? [];
}

function hasPlugins(plugins: CliConfig['plugins']): boolean {
  return Array.isArray(plugins) && plugins.length > 0;
}
