import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  materializePreviousMap,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import { Node, Root, asProcessRoot, fromAst } from './ast.js';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from './codec.js';
import {
  AsyncBackendUnavailableError,
  AsyncPluginError,
  isThenable,
  observeThenable,
} from './errors.js';
import { attachInputMetadata } from './input.js';
import { parseOwnedSync } from './parser.js';
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

type NativeAddon = {
  parse(css: string, from?: string): Buffer;
  parseAsync(css: string, from?: string): Promise<Buffer>;
  stringify(ast: Buffer, optionsJson?: string): string;
  stringifyAsync(ast: Buffer, optionsJson?: string): Promise<string>;
  process(css: string, optionsJson?: string): Buffer;
  processAsync(css: string, optionsJson?: string): Promise<Buffer>;
  noWork(css: string, optionsJson?: string): string;
  noWorkAsync(css: string, optionsJson?: string): Promise<string>;
};

export type LiveParseResult = { root: Root };

const PROCESS_FRAME_MAGIC = 'PCGP';
const PROCESS_FRAME_HEADER_SIZE = 8;
const CSS_SYNTAX_ERROR_PREFIX = 'postcss-go:css-syntax:';

let cachedAddon: NativeAddon | null | undefined;

/** Platform package tuples to try, matching `@postcss-go/native-<tuple>`. */
function hostTuples(): string[] {
  const { platform, arch } = process;
  if (platform === 'linux') return [`linux-${arch}-gnu`, `linux-${arch}-musl`];
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
    for (const tuple of hostTuples()) {
      try {
        cachedAddon = require(`@postcss-go/native-${tuple}`) as NativeAddon;
        return cachedAddon;
      } catch {
        // try next tuple or local fallback
      }
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

/**
 * In-process bridge with two explicit execution surfaces. Promise methods run
 * Go through Node-API async work; `*Sync` methods call the same binary ABI on
 * the Node thread. Live-tree helpers avoid an intermediate DTO on plugin paths.
 */
export class NativePostcssGoService implements SyncPostcssGoService {
  readonly capabilities = NATIVE_BACKEND_CAPABILITIES;

  constructor(private readonly addon: NativeAddon) {}

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
      return { ...stringified, root, messages: [] };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      return decodeProcessFrame(await this.addon.processAsync(css, JSON.stringify(normalized)));
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
      return { ...stringified, root, messages: [] };
    }
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    try {
      return decodeProcessFrame(this.addon.process(css, JSON.stringify(normalized)));
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
  // Re-run only the owned parser's error path to recover structured source
  // metadata that Node-API's string-only error slot cannot transport.
  const structuredError = captureParserError(css, options);
  if (structuredError) throw structuredError;
  throw nativeError;
}

function captureParserError(css: string, options: ProcessOptions): unknown {
  try {
    parseOwnedSync(css, options);
    return undefined;
  } catch (error) {
    return error;
  }
}
