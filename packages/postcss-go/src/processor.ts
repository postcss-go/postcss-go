import { materializePreviousMap, type ProcessFileOptions } from '@postcss-go/shared/map-options';

import { asProcessRoot, fromAst, Node, Root, toAst } from './ast.js';
import { stringify as stringifyOwned } from './ast-stringifier.js';
import { SyncBackendUnavailableError } from './errors.js';
import {
  createDefaultAsyncService,
  createNativeService,
  getDefaultAsyncBackendCapabilities,
  isNativeBridgeAvailable,
  NativePostcssGoService,
} from './native.js';
import { attachInputMetadata } from './input.js';
import {
  postcssApi,
  runPluginsWithBridge,
  runPluginsWithBridgeSync,
  setProcessorFactory,
  type PostcssPublic,
  type RuntimePlugin,
} from './plugin-runtime.js';
import type { AcceptedPlugin, Plugin } from './plugin-types.js';
import { hydrateResultMap, hydrateResultMessages, Result } from './result.js';
import { NATIVE_BACKEND_CAPABILITIES, type PostcssGoService } from './service.js';
import type { ProcessOptions, RootNode, DocumentNode } from './types.js';
import { prepareStringifyOptions } from './source-map-output.js';

export type CssInput = string | { toString(): string };
export type PublicResult = Result<RuntimePlugin>;

export interface ProcessorOptions {
  /** Reuse an existing transport. The caller remains responsible for closing it. */
  service?: PostcssGoService;
}

export interface PostcssGoCapabilities {
  /** Backend selected by default for Promise-returning APIs. */
  readonly asynchronous: typeof NATIVE_BACKEND_CAPABILITIES | null;
  /** Backend available to explicit synchronous APIs, or null when unavailable. */
  readonly synchronous: typeof NATIVE_BACKEND_CAPABILITIES | null;
}

export function getBackendCapabilities(): PostcssGoCapabilities {
  return {
    asynchronous: getDefaultAsyncBackendCapabilities(),
    synchronous: isNativeBridgeAvailable() ? NATIVE_BACKEND_CAPABILITIES : null,
  };
}

/**
 * PostCSS-shaped processor with explicit Promise-returning and synchronous
 * methods. Unlike PostCSS, no implicit LazyResult execution is performed.
 */
export class Processor {
  version = '0.0.1';
  plugins: AcceptedPlugin[];

  constructor(plugins: AcceptedPlugin[] = []) {
    this.plugins = this.normalize(plugins);
  }

  use(plugin: AcceptedPlugin | AcceptedPlugin[]): this {
    this.plugins.push(...this.normalize(Array.isArray(plugin) ? plugin : [plugin]));
    return this;
  }

  normalize(plugins: readonly AcceptedPlugin[]): AcceptedPlugin[] {
    const normalized: AcceptedPlugin[] = [];
    for (const plugin of plugins) {
      if (
        plugin &&
        typeof plugin === 'object' &&
        'plugins' in plugin &&
        Array.isArray(plugin.plugins)
      ) {
        normalized.push(...this.normalize(plugin.plugins));
      } else if (
        typeof plugin === 'function' ||
        (plugin && typeof plugin === 'object' && ('postcssPlugin' in plugin || 'postcss' in plugin))
      ) {
        normalized.push(plugin);
      } else {
        throw new Error(`${String(plugin)} is not a PostCSS plugin`);
      }
    }
    return normalized;
  }

  async process(
    cssInput: CssInput,
    options: ProcessFileOptions = {},
    processorOptions: ProcessorOptions = {},
  ): Promise<PublicResult> {
    options = materializePreviousMap(options);
    const css = String(cssInput);
    const ownedService = processorOptions.service ? undefined : createAsyncService();
    const service = processorOptions.service ?? ownedService!;
    try {
      if (this.plugins.length > 0) {
        return await runPluginsWithBridge(service, this.plugins, css, options, this);
      }
      const processed = await service.process(css, options as ProcessOptions);
      const root = asProcessRoot(
        processed.root instanceof Node
          ? processed.root
          : fromAst(processed.root as RootNode | DocumentNode),
      );
      attachInputMetadata(root, css, options as ProcessOptions);
      const result = new Result<RuntimePlugin>(this, root, options);
      result.css = processed.css;
      result.map = hydrateResultMap(processed.map);
      result.mapFile = processed.mapFile;
      result.messages.push(...hydrateResultMessages(processed.messages));
      return result;
    } finally {
      if (ownedService) await ownedService.close();
    }
  }

  processSync(cssInput: CssInput, options: ProcessFileOptions = {}): PublicResult {
    options = materializePreviousMap(options);
    const service = requireSyncService();
    const css = String(cssInput);
    if (this.plugins.length > 0) {
      return runPluginsWithBridgeSync(service, this.plugins, css, options, this);
    }
    const processed = service.processSync(css, options as ProcessOptions);
    const root = asProcessRoot(
      processed.root instanceof Node
        ? processed.root
        : fromAst(processed.root as RootNode | DocumentNode),
    );
    attachInputMetadata(root, css, options as ProcessOptions);
    const result = new Result<RuntimePlugin>(this, root, options);
    result.css = processed.css;
    result.map = hydrateResultMap(processed.map);
    result.mapFile = processed.mapFile;
    result.messages.push(...hydrateResultMessages(processed.messages));
    return result;
  }
}

export type Postcss = PostcssPublic;

export const postcss = Object.assign(postcssApi, {
  node: Node,
  Processor,
  plugin<T extends unknown[]>(
    name: string,
    initializer: (...args: T) => Omit<Plugin, 'postcssPlugin'> | Plugin,
  ) {
    const creator = ((...args: T): Plugin => ({
      ...initializer(...args),
      postcssPlugin: name,
    })) as ((...args: T) => Plugin) & { postcss: true };
    creator.postcss = true;
    return creator;
  },
}) as Postcss;

Object.defineProperty(postcss, 'default', {
  configurable: true,
  enumerable: true,
  value: postcss,
});

setProcessorFactory((plugins) => new Processor(plugins));

export function parseSync(css: CssInput, options: ProcessOptions = {}): Root {
  options = materializePreviousMap(options);
  const text = String(css);
  const root = asProcessRoot(requireSyncService().parseSync(text, options).root);
  if (!(root instanceof Root)) throw new Error('postcss-go parseSync response is not a root');
  attachInputMetadata(root, text, options);
  return root;
}

export function processSync(
  css: CssInput,
  options: ProcessFileOptions = {},
  plugins: AcceptedPlugin[] = [],
): PublicResult {
  return new Processor(plugins).processSync(css, options);
}

export function noWorkSync(css: CssInput, options: ProcessOptions = {}) {
  options = materializePreviousMap(options);
  return requireSyncService().noWorkSync(String(css), options);
}

export function stringifySync(
  node: Node,
  builderOrOptions?: ((chunk: string, node?: Node, type?: string) => void) | ProcessOptions,
): string | void {
  if (typeof builderOrOptions === 'function') {
    stringifyOwned(node, builderOrOptions as never);
    return;
  }
  const options = materializePreviousMap(builderOrOptions ?? {});
  const effectiveOptions = prepareStringifyOptions(node, options);
  return requireSyncService().stringifySync(toAst(node), effectiveOptions);
}

function createAsyncService(): PostcssGoService {
  return createDefaultAsyncService();
}

function requireSyncService(): NativePostcssGoService {
  if (!isNativeBridgeAvailable()) throw new SyncBackendUnavailableError();
  return createNativeService();
}
