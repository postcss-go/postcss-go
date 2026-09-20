import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import {
  Node,
  asProcessRoot,
  fromAst,
  setConstructedNodeIntern,
  setSyncCssRuntime,
  type Builder,
  type Root,
} from './ast.js';
import {
  AsyncBackendUnavailableError,
  AsyncPluginError,
  CssSyntaxError,
  cssSyntaxErrorFromDto,
  isThenable,
  observeThenable,
  type CssSyntaxErrorDTO,
} from './errors.js';
import { attachInputMetadata } from './input.js';
import { currentModulePath } from './module-path.js';
import {
  NATIVE_BACKEND_CAPABILITIES,
  type PostcssGoService,
  type SyncPostcssGoService,
} from './service.js';
import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
} from './types.js';
import { prepareStringifyOptions, finalizeMappedCSS } from './source-map-output.js';
import { stringifyDocumentChildren } from './document-stringify.js';
import { hasHandleBridge, type HandleBridge } from './handle-session.js';
import { ownerOf } from './handle-facade.js';
import {
  internDetached,
  isGoOwned,
  parseRetained,
  setDefaultHandleBridge,
} from './retained-session.js';

type NativeAddon = {
  parse(css: string, from?: string): Buffer;
  parseAsync(css: string, from?: string): Promise<Buffer>;
  stringify(ast: Buffer, optionsJson?: string): string;
  stringifyAsync(ast: Buffer, optionsJson?: string): Promise<string>;
  process(css: string, optionsJson?: string): Buffer;
  processAsync(css: string, optionsJson?: string): Promise<Buffer>;
  noWork(css: string, optionsJson?: string): string;
  noWorkAsync(css: string, optionsJson?: string): Promise<string>;
  stringifyBuilder(ast: Buffer, optionsJson?: string): string;
} & Partial<HandleBridge>;

export type LiveParseResult = { root: Root };

const CSS_SYNTAX_ERROR_PREFIX = 'postcss-go:css-syntax:';

let cachedAddon: NativeAddon | null | undefined;

/** Platform package tuples to try, matching `@postcss-go/native-<tuple>`. */
function hostTuples(): string[] {
  const { platform, arch } = process;
  if (platform === 'linux') {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return report?.header?.glibcVersionRuntime ? [`linux-${arch}-gnu`] : [];
  }
  if (platform === 'win32') return [`win32-${arch}-msvc`];
  return [`${platform}-${arch}`];
}

function loadAddon(): NativeAddon | null {
  if (process.env.POSTCSS_GO_DISABLE_NATIVE === '1') return null;
  if (cachedAddon !== undefined) return cachedAddon;
  try {
    const modulePath = currentModulePath(import.meta.url);
    const require = createRequire(modulePath);
    const here = dirname(modulePath);

    // Prefer the published / workspace platform package (same path in
    // development after `native/build.mjs` and in production after install).
    const tuples = hostTuples();
    for (const tuple of tuples) {
      try {
        cachedAddon = require(`@postcss-go/native-${tuple}`) as NativeAddon;
        return cachedAddon;
      } catch {
        // try next tuple or local fallback
      }
    }

    // Stock Go cannot put its initial-exec TLS runtime in a dlopen'ed musl
    // addon (golang/go#54805), so do not probe a glibc or local binary there.
    if (process.platform === 'linux' && tuples.length === 0) {
      cachedAddon = null;
      return null;
    }

    // Local node-gyp output before the place step finishes.
    for (const candidate of [
      resolve(here, '../native/build/Release/postcss_go.node'),
      resolve(here, '../../native/build/Release/postcss_go.node'),
    ]) {
      try {
        cachedAddon = require(candidate) as NativeAddon;
        return cachedAddon;
      } catch {
        // try next path
      }
    }
    cachedAddon = null;
    return null;
  } catch {
    cachedAddon = null;
    return null;
  }
}

/** True when the sync native addon is available for this platform. */
export function isNativeBridgeAvailable(): boolean {
  return loadAddon() !== null;
}

/** True when the addon exposes genuine worker-backed Promise operations. */
export function isNativeAsyncBridgeAvailable(): boolean {
  const addon = loadAddon();
  return (
    addon !== null &&
    typeof addon.parseAsync === 'function' &&
    typeof addon.stringifyAsync === 'function' &&
    typeof addon.processAsync === 'function' &&
    typeof addon.noWorkAsync === 'function'
  );
}

/** Create the native backend used by all Promise-returning Node APIs. */
export function createDefaultAsyncService(): PostcssGoService {
  if (!isNativeAsyncBridgeAvailable()) throw new AsyncBackendUnavailableError();
  return createNativeService();
}

export function getDefaultAsyncBackendCapabilities(): typeof NATIVE_BACKEND_CAPABILITIES | null {
  return isNativeAsyncBridgeAvailable() ? NATIVE_BACKEND_CAPABILITIES : null;
}

export function createNativeService(): NativePostcssGoService {
  const addon = loadAddon();
  if (!addon) {
    throw new Error(
      'postcss-go native addon is unavailable; run `pnpm --filter @postcss-go/core build:native`',
    );
  }
  return new NativePostcssGoService(addon);
}

/** Point AST helpers at the N-API parse/stringify runtime. */
export function installNativeSyncCssRuntime(): void {
  if (!isNativeBridgeAvailable()) {
    setSyncCssRuntime(undefined);
    setDefaultHandleBridge(null);
    setConstructedNodeIntern(undefined);
    return;
  }
  const service = createNativeService();
  setDefaultHandleBridge(service.handleBridge);
  setConstructedNodeIntern(internDetached);
  setSyncCssRuntime({
    parse(css, options = {}) {
      const cssText = String(css);
      const root = service.parseSync(cssText, options).root;
      if (!isGoOwned(root)) attachInputMetadata(root, cssText, options);
      return root;
    },
    stringify(node, builder) {
      if (builder) {
        service.stringifyBuilderSync(node, builder);
        return;
      }
      return service.stringifyNodeSync(node);
    },
  });
}

/**
 * In-process bridge with two explicit execution surfaces. Promise methods run
 * Go through Node-API async work; `*Sync` methods call the same binary ABI on
 * the Node thread. Live-tree helpers avoid an intermediate DTO on plugin paths.
 */
export class NativePostcssGoService implements SyncPostcssGoService {
  readonly capabilities = NATIVE_BACKEND_CAPABILITIES;
  readonly handleBridge: HandleBridge | null;

  constructor(private readonly addon: NativeAddon) {
    this.handleBridge = hasHandleBridge(addon) ? addon : null;
  }

  private requireHandle(): HandleBridge {
    if (!this.handleBridge) throw new Error('postcss-go handle bridge is unavailable');
    return this.handleBridge;
  }

  private parseOwned(css: string, options: ProcessOptions): LiveParseResult {
    return {
      root: parseRetained(this.requireHandle(), css, {
        from: options.from,
        document: options.document == null ? undefined : String(options.document),
        map: options.map,
      }) as Root,
    };
  }

  private stringifyOwned(ast: AstNode | Node, options: ProcessOptions): AstStringifyResult {
    const live = ast instanceof Node ? ast : internDetached(fromAst(ast));
    const owner = ownerOf(live);
    const handle = owner?.handleId(live);
    if (!owner || handle === undefined) {
      if (live instanceof Node && live.type === 'document') {
        const css = this.stringifyNodeSync(live);
        if (!options.map) return { css };
        const first = (live as { first?: Node }).first;
        const firstOwner = first ? ownerOf(first) : undefined;
        const firstHandle = first && firstOwner ? firstOwner.handleId(first) : undefined;
        if (!first || !firstOwner || firstHandle === undefined) return { css };
        firstOwner.flushPatches();
        const mapOpts = options.map && typeof options.map === 'object' ? options.map : {};
        const mapped = firstOwner.session.stringifyMap(firstHandle, {
          from: options.from,
          to: options.to,
          absolute: Boolean((mapOpts as { absolute?: boolean }).absolute),
          preserveAnnotation: (mapOpts as { annotation?: unknown }).annotation !== false,
        });
        return finalizeMappedCSS(css, mapped.map, options);
      }
      throw new Error('postcss-go stringify requires a Go-owned tree');
    }
    const wantsMap = Boolean(options.map);
    if (!wantsMap) return { css: owner.session.stringify(handle) };
    const mapOpts = options.map && typeof options.map === 'object' ? options.map : {};
    const mapped = owner.session.stringifyMap(handle, {
      from: options.from,
      to: options.to,
      absolute: Boolean((mapOpts as { absolute?: boolean }).absolute),
      preserveAnnotation: (mapOpts as { annotation?: unknown }).annotation !== false,
    });
    return finalizeMappedCSS(mapped.css, mapped.map, options);
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    options = materializePreviousMap(options);
    try {
      return this.parseOwned(css, options);
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  async parseLive(css: string, options: ProcessOptions = {}): Promise<LiveParseResult> {
    return this.parse(css, options) as Promise<LiveParseResult>;
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options) || options.map) {
      const root = (await this.parseLive(css, { from: options.from, map: options.map })).root;
      const effective = await this.resolveStringifyAnnotationLive(root, options);
      const stringified = await this.stringifyResultLive(root, effective);
      return { ...stringified, root, messages: [], backend: 'native' };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      const payload = JSON.parse(
        await this.addon.noWorkAsync(css, JSON.stringify(normalized)),
      ) as NoWorkResult;
      const root = this.parseOwned(css, options).root;
      return { ...payload, root, messages: [], backend: 'native' };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  processSync(css: string, options: ProcessOptions = {}): ProcessResult {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options) || options.map) {
      const root = this.parseSync(css, { from: options.from, map: options.map }).root;
      const effective = this.resolveStringifyAnnotationSync(root, options);
      const stringified = this.stringifyResultSync(root, effective);
      return { ...stringified, root, messages: [], backend: 'native' };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      const payload = JSON.parse(
        this.addon.noWork(css, JSON.stringify(normalized)),
      ) as NoWorkResult;
      const root = this.parseOwned(css, options).root;
      return { ...payload, root, messages: [], backend: 'native' };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  async noWork(css: string, options: ProcessOptions = {}): Promise<NoWorkResult> {
    options = materializePreviousMap(options);
    const effective = await this.resolveNoWorkAnnotation(options);
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      await this.addon.noWorkAsync(css, JSON.stringify(normalized)),
    ) as NoWorkResult;
  }

  noWorkSync(css: string, options: ProcessOptions = {}): NoWorkResult {
    options = materializePreviousMap(options);
    const effective = this.resolveNoWorkAnnotationSync(options);
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(this.addon.noWork(css, JSON.stringify(normalized))) as NoWorkResult;
  }

  async stringify(ast: AstNode): Promise<string> {
    return (await this.stringifyResult(ast)).css;
  }

  async stringifyResult(ast: AstNode, options: ProcessOptions = {}): Promise<AstStringifyResult> {
    options = materializePreviousMap(options);
    const prepared = prepareStringifyOptions(ast, options);
    const effective = await this.resolveStringifyAnnotation(ast, prepared);
    return this.stringifyOwned(ast, effective);
  }

  async stringifyResultLive(
    ast: AstNode | Node,
    options: ProcessOptions = {},
  ): Promise<AstStringifyResult> {
    options = materializePreviousMap(options);
    const prepared = prepareStringifyOptions(ast, options);
    const effective = await this.resolveStringifyAnnotationLive(ast, prepared);
    return this.stringifyOwned(ast, effective);
  }

  parseSync(css: string, options: ProcessOptions = {}): LiveParseResult {
    options = materializePreviousMap(options);
    try {
      return this.parseOwned(css, options);
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  stringifyResultSync(ast: AstNode | Node, options: ProcessOptions = {}): AstStringifyResult {
    options = materializePreviousMap(options);
    const prepared = prepareStringifyOptions(ast, options);
    const effective = this.resolveStringifyAnnotationSync(ast, prepared);
    return this.stringifyOwned(ast, effective);
  }

  stringifySync(ast: AstNode | Node, options: ProcessOptions = {}): string {
    return this.stringifyResultSync(ast, options).css;
  }

  stringifyNodeSync(node: Node): string {
    const owner = ownerOf(node);
    const handle = owner?.handleId(node);
    if (owner && handle !== undefined) {
      owner.flushPatches();
      return owner.session.stringify(handle);
    }
    if (node.type === 'document') {
      return stringifyDocumentChildren(node, (child) => this.stringifyNodeSync(child));
    }
    const interned = internDetached(node);
    const internOwner = ownerOf(interned);
    const internHandle = internOwner?.handleId(interned);
    if (!internOwner || internHandle === undefined) {
      throw new Error('postcss-go stringify requires a Go-owned tree');
    }
    internOwner.flushPatches();
    return internOwner.session.stringify(internHandle);
  }

  stringifyBuilderSync(node: Node, builder: Builder): void {
    const interned = ownerOf(node) ? node : internDetached(node);
    const owner = ownerOf(interned);
    const handle = owner?.handleId(interned);
    if (!owner || handle === undefined) {
      throw new Error('postcss-go stringify requires a Go-owned tree');
    }
    for (const part of owner.session.stringifyBuilder(handle)) {
      const live = part.node ? owner.node(part.node) : undefined;
      builder(part.css, live, part.type || undefined);
    }
  }

  async close(): Promise<void> {
    // Native addon holds no external process.
  }

  private resolveNoWorkAnnotationSync(options: ProcessOptions): ProcessOptions {
    const map = options.map;
    if (!map || typeof map !== 'object' || typeof map.annotation !== 'function') return options;
    const annotation = (
      map.annotation as (file?: string, root?: unknown) => string | Promise<string>
    )(options.to, undefined);
    if (isThenable(annotation)) {
      observeThenable(annotation);
      throw new AsyncPluginError('map.annotation');
    }
    return { ...options, map: { ...map, annotation } };
  }

  private resolveStringifyAnnotationSync(
    root: AstNode | Node,
    options: ProcessOptions,
  ): ProcessOptions {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const live = asProcessRoot(root instanceof Node ? root : internDetached(fromAst(root)));
    const annotation = options.map.annotation(options.to, live as never);
    if (isThenable(annotation)) {
      observeThenable(annotation);
      throw new AsyncPluginError('map.annotation');
    }
    return { ...options, map: { ...options.map, annotation } };
  }

  private async resolveStringifyAnnotation(
    root: AstNode,
    options: ProcessOptions,
  ): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const live = asProcessRoot(internDetached(fromAst(root)));
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  private async resolveStringifyAnnotationLive(
    root: AstNode | Node,
    options: ProcessOptions,
  ): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const live = asProcessRoot(root instanceof Node ? root : internDetached(fromAst(root)));
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  private async resolveNoWorkAnnotation(options: ProcessOptions): Promise<ProcessOptions> {
    const map = options.map;
    if (!map || typeof map !== 'object' || typeof map.annotation !== 'function') return options;
    const annotation = await (
      map.annotation as (file?: string, root?: unknown) => string | Promise<string>
    )(options.to, undefined);
    return { ...options, map: { ...map, annotation } };
  }
}

function hasAnnotationCallback(options: ProcessOptions): boolean {
  return (
    !!options.map && typeof options.map === 'object' && typeof options.map.annotation === 'function'
  );
}

function throwStructuredSyntaxError(
  css: string,
  options: ProcessOptions,
  nativeError: unknown,
): never {
  if (!(nativeError instanceof Error) || !nativeError.message.startsWith(CSS_SYNTAX_ERROR_PREFIX)) {
    throw nativeError;
  }
  const payload = nativeError.message.slice(CSS_SYNTAX_ERROR_PREFIX.length).trim();
  const fallback = { source: css, file: options.from };
  if (payload.startsWith('{')) {
    let dto: CssSyntaxErrorDTO;
    try {
      dto = JSON.parse(payload) as CssSyntaxErrorDTO;
    } catch {
      throw new CssSyntaxError(payload, fallback);
    }
    throw cssSyntaxErrorFromDto(dto, fallback);
  }
  throw new CssSyntaxError(payload, fallback);
}
