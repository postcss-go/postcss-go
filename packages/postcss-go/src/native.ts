import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import { Node, asProcessRoot, fromAst, setSyncCssRuntime, type Builder, type Root } from './ast.js';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from './codec.js';
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
  ResultMessage,
} from './types.js';
import { prepareStringifyOptions } from './source-map-output.js';
import { hasNativeHandleBridge, type NativeHandleAddon } from './handle-session.js';

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
} & Partial<NativeHandleAddon>;

export type LiveParseResult = { root: Root };

const PROCESS_FRAME_MAGIC = 'PCGP';
const PROCESS_FRAME_HEADER_SIZE = 8;
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
    const require = createRequire(import.meta.url);
    const here = dirname(fileURLToPath(import.meta.url));

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

function encodeBoundaryAst(ast: AstNode | Node): Buffer {
  return ast instanceof Node ? serializeAst(ast) : encodeAst(ast);
}

function indexLiveNodes(node: Node): Node[] {
  const nodes: Node[] = [];
  const visit = (current: Node): void => {
    nodes.push(current);
    for (const child of (current as Node & { nodes?: Node[] }).nodes ?? []) visit(child);
  };
  visit(node);
  return nodes;
}

/** Encode the node's root so Go can infer raws from siblings, plus a 1-based index. */
function encodeStringifyTarget(node: Node): { buffer: Buffer; options?: string } {
  const root = node.root();
  if (root === node) return { buffer: serializeAst(node) };
  const nodeIndex = indexLiveNodes(root).indexOf(node) + 1;
  return {
    buffer: serializeAst(root),
    options: nodeIndex > 0 ? JSON.stringify({ nodeIndex }) : undefined,
  };
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
      'postcss-go native addon is unavailable; run `pnpm --filter postcss-go build:native`',
    );
  }
  return new NativePostcssGoService(addon);
}

/** Point AST helpers at the N-API parse/stringify runtime. */
export function installNativeSyncCssRuntime(): void {
  if (!isNativeBridgeAvailable()) {
    setSyncCssRuntime(undefined);
    return;
  }
  const service = createNativeService();
  setSyncCssRuntime({
    parse(css, options = {}) {
      const cssText = String(css);
      const root = service.parseSync(cssText, options).root;
      attachInputMetadata(root, cssText, options);
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
  readonly handleAddon: NativeHandleAddon | null;

  constructor(private readonly addon: NativeAddon) {
    this.handleAddon = hasNativeHandleBridge(addon) ? addon : null;
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    options = materializePreviousMap(options);
    try {
      const buffer = await this.addon.parseAsync(css, options.from);
      return { root: decodeAst(buffer) as ParseResult['root'] };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  /** Parse asynchronously into a live tree without an intermediate DTO. */
  async parseLive(css: string, options: ProcessOptions = {}): Promise<LiveParseResult> {
    options = materializePreviousMap(options);
    try {
      return { root: hydrateAst(await this.addon.parseAsync(css, options.from)) };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options)) {
      const root = (await this.parseLive(css, { from: options.from })).root;
      attachInputMetadata(root, css, options);
      const effective = await this.resolveStringifyAnnotationLive(root, options);
      const stringified = await this.stringifyResultLive(root, effective);
      return { ...stringified, root, messages: [], backend: 'native' };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      return {
        ...decodeProcessFrame(await this.addon.processAsync(css, JSON.stringify(normalized))),
        backend: 'native',
      };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  processSync(css: string, options: ProcessOptions = {}): ProcessResult {
    options = materializePreviousMap(options);
    if (hasAnnotationCallback(options)) {
      const root = this.parseSync(css, { from: options.from }).root;
      attachInputMetadata(root, css, options);
      const effective = this.resolveStringifyAnnotationSync(root, options);
      const stringified = this.stringifyResultSync(root, effective);
      return { ...stringified, root, messages: [], backend: 'native' };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      return {
        ...decodeProcessFrame(this.addon.process(css, JSON.stringify(normalized))),
        backend: 'native',
      };
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
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      await this.addon.stringifyAsync(encodeAst(ast), JSON.stringify(normalized)),
    ) as AstStringifyResult;
  }

  /** Stringify a live tree asynchronously without converting it to a DTO. */
  async stringifyResultLive(
    ast: AstNode | Node,
    options: ProcessOptions = {},
  ): Promise<AstStringifyResult> {
    options = materializePreviousMap(options);
    const prepared = prepareStringifyOptions(ast, options);
    const effective = await this.resolveStringifyAnnotationLive(ast, prepared);
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      await this.addon.stringifyAsync(encodeBoundaryAst(ast), JSON.stringify(normalized)),
    ) as AstStringifyResult;
  }

  async close(): Promise<void> {
    // Native addon holds no external process.
  }

  /**
   * Parse into a live TypeScript AST. Prefer this over `parse` + `fromAst` on
   * the plugin hot path.
   */
  parseSync(css: string, options: ProcessOptions = {}): LiveParseResult {
    options = materializePreviousMap(options);
    try {
      return { root: hydrateAst(this.addon.parse(css, options.from)) };
    } catch (nativeError) {
      throwStructuredSyntaxError(css, options, nativeError);
    }
  }

  /**
   * Stringify a live TypeScript AST (or a plain DTO). Prefer passing a live
   * node so `toAst` can be skipped.
   */
  stringifyResultSync(ast: AstNode | Node, options: ProcessOptions = {}): AstStringifyResult {
    options = materializePreviousMap(options);
    const prepared = prepareStringifyOptions(ast, options);
    const effective = this.resolveStringifyAnnotationSync(ast, prepared);
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      this.addon.stringify(encodeBoundaryAst(ast), JSON.stringify(normalized)),
    ) as AstStringifyResult;
  }

  stringifySync(ast: AstNode | Node, options: ProcessOptions = {}): string {
    return this.stringifyResultSync(ast, options).css;
  }

  /** Stringify a live node without map options, for `Node#toString()`. */
  stringifyNodeSync(node: Node): string {
    const target = encodeStringifyTarget(node);
    return (JSON.parse(this.addon.stringify(target.buffer, target.options)) as AstStringifyResult)
      .css;
  }

  /** Replay Go builder chunks onto a PostCSS-shaped callback. */
  stringifyBuilderSync(node: Node, builder: Builder): void {
    const target = encodeStringifyTarget(node);
    const parts = JSON.parse(this.addon.stringifyBuilder(target.buffer, target.options)) as Array<{
      css: string;
      node?: number;
      type?: string;
    }>;
    const indexed = indexLiveNodes(node);
    for (const part of parts) {
      const live = part.node && part.node > 0 ? indexed[part.node - 1] : undefined;
      builder(part.css, live, part.type || undefined);
    }
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
    const live = asProcessRoot(root instanceof Node ? root : fromAst(root));
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
    const live = asProcessRoot(fromAst(root));
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
    const live = asProcessRoot(root instanceof Node ? root : fromAst(root));
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

function decodeProcessFrame(frame: Buffer): ProcessResult {
  if (
    frame.length < PROCESS_FRAME_HEADER_SIZE ||
    frame.subarray(0, 4).toString('ascii') !== PROCESS_FRAME_MAGIC
  ) {
    throw new Error('postcss-go native process response has an invalid frame');
  }
  const metadataLength = frame.readUInt32LE(4);
  const rootOffset = PROCESS_FRAME_HEADER_SIZE + metadataLength;
  if (rootOffset > frame.length) {
    throw new Error('postcss-go native process response has invalid metadata length');
  }
  const metadata = JSON.parse(
    frame.subarray(PROCESS_FRAME_HEADER_SIZE, rootOffset).toString('utf8'),
  ) as {
    css: string;
    map?: string;
    mapFile?: string;
    messages?: ResultMessage[];
  };
  return {
    css: metadata.css,
    map: metadata.map,
    mapFile: metadata.mapFile,
    root: hydrateAst(frame.subarray(rootOffset)),
    messages: metadata.messages ?? [],
  };
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
