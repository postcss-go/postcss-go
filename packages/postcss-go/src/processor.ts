import { createRequire } from 'node:module';

import { type ProcessFileOptions } from 'postcss-go-shared/map-options';

import { Node, stringifyCssSync, type Root } from './ast.js';
import { SyncBackendUnavailableError } from './errors.js';
import { throwInvalidPlugin } from './plugin-normalize.js';
import {
  createDefaultAsyncService,
  createNativeService,
  getDefaultAsyncBackendCapabilities,
  installNativeSyncCssRuntime,
  isNativeBridgeAvailable,
  NativePostcssGoService,
} from './native.js';
import {
  postcssApi,
  setProcessorFactory,
  type PostcssPublic,
  type PluginResult,
} from './plugin-runtime.js';
import type { AcceptedPlugin, Plugin } from './plugin-types.js';
import { NATIVE_BACKEND_CAPABILITIES, type PostcssGoService } from './service.js';
import type { ProcessOptions } from './types.js';
import {
  dispatchNoWorkSync,
  dispatchParseSync,
  dispatchProcess,
  dispatchProcessSync,
  dispatchStringifySync,
} from './dispatch.js';

const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

export type CssInput = string | { toString(): string };
export type PublicResult = PluginResult;

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

export class Processor {
  version = packageVersion;
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
        throwInvalidPlugin(plugin);
      }
    }
    return normalized;
  }

  async process(
    cssInput: CssInput,
    options: ProcessFileOptions = {},
    processorOptions: ProcessorOptions = {},
  ): Promise<PublicResult> {
    const css = String(cssInput);
    const ownedService = processorOptions.service ? undefined : createAsyncService();
    const service = processorOptions.service ?? ownedService!;
    try {
      return await dispatchProcess(service, css, options, this.plugins, this);
    } finally {
      if (ownedService) await ownedService.close();
    }
  }

  processSync(cssInput: CssInput, options: ProcessFileOptions = {}): PublicResult {
    return dispatchProcessSync(requireSyncService(), String(cssInput), options, this.plugins, this);
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
installNativeSyncCssRuntime();

export function parseSync(css: CssInput, options: ProcessOptions = {}): Root {
  return dispatchParseSync(requireSyncService(), String(css), options);
}

export function processSync(
  css: CssInput,
  options: ProcessFileOptions = {},
  plugins: AcceptedPlugin[] = [],
): PublicResult {
  return new Processor(plugins).processSync(css, options);
}

export function noWorkSync(css: CssInput, options: ProcessOptions = {}) {
  return dispatchNoWorkSync(requireSyncService(), String(css), options);
}

export function stringifySync(
  node: Node,
  builderOrOptions?: ((chunk: string, node?: Node, type?: string) => void) | ProcessOptions,
): string | void {
  if (typeof builderOrOptions === 'function') {
    stringifyCssSync(node, builderOrOptions);
    return;
  }
  return dispatchStringifySync(requireSyncService(), node, builderOrOptions ?? {});
}

function createAsyncService(): PostcssGoService {
  return createDefaultAsyncService();
}

function requireSyncService(): NativePostcssGoService {
  if (!isNativeBridgeAvailable()) throw new SyncBackendUnavailableError();
  return createNativeService();
}
