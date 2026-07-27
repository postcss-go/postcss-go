import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyMapAnnotation,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';

import { Node, Root } from './ast.js';
import { decodeAst, encodeAst, hydrateAst, serializeAst } from './codec.js';
import type { PostcssGoService } from './service.js';
import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  Warning,
} from './types.js';

type NativeAddon = {
  parse(css: string, from?: string): Buffer;
  stringify(ast: Buffer, optionsJson?: string): string;
  process(css: string, optionsJson?: string): string;
  noWork(css: string, optionsJson?: string): string;
};

export type LiveParseResult = { root: Root };

let cachedAddon: NativeAddon | null | undefined;

function loadAddon(): NativeAddon | null {
  if (cachedAddon !== undefined) return cachedAddon;
  try {
    const require = createRequire(import.meta.url);
    const here = dirname(fileURLToPath(import.meta.url));
    const platform = `${process.platform}-${process.arch}`;
    const candidates = [
      // Published packages keep platform-specific addons outside npm's
      // implicitly ignored build/ directory.
      resolve(here, `../native/prebuilds/${platform}/postcss_go.node`),
      // Development fallback before/without copying the prebuild.
      resolve(here, '../native/build/Release/postcss_go.node'),
      resolve(here, '../../native/build/Release/postcss_go.node'),
    ];
    for (const candidate of candidates) {
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

export function createNativeService(): NativePostcssGoService {
  const addon = loadAddon();
  if (!addon) {
    throw new Error(
      'postcss-go native addon is unavailable; run `node packages/postcss-go/native/build.mjs`',
    );
  }
  return new NativePostcssGoService(addon);
}

/**
 * Synchronous in-process bridge. Parse/stringify move a binary AST across the
 * Go↔JS boundary instead of JSON over stdio. The sync helpers hydrate and
 * serialize live TypeScript AST nodes so the plugin runtime never builds an
 * intermediate plain DTO.
 */
export class NativePostcssGoService implements PostcssGoService {
  constructor(private readonly addon: NativeAddon) {}

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    const buffer = this.addon.parse(css, options.from);
    return { root: decodeAst(buffer) as ParseResult['root'] };
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    const effective = await this.resolveAnnotation(css, options);
    const normalized = normalizeProcessOptions(
      effective as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const payload = JSON.parse(this.addon.process(css, JSON.stringify(normalized))) as {
      css: string;
      map?: string;
      messages?: Warning[];
      rootBin: string;
    };
    return {
      css: payload.css,
      map: payload.map,
      root: decodeAst(Buffer.from(payload.rootBin, 'base64')) as ProcessResult['root'],
      messages: payload.messages ?? [],
    };
  }

  async noWork(css: string, options: ProcessOptions = {}): Promise<NoWorkResult> {
    const effective = await this.resolveAnnotation(css, options);
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
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      this.addon.stringify(encodeAst(ast), JSON.stringify(normalized)),
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
    return { root: hydrateAst(this.addon.parse(css, options.from)) };
  }

  /**
   * Stringify a live TypeScript AST (or a plain DTO). Prefer passing a live
   * node so `toAst` can be skipped.
   */
  stringifyResultSync(ast: AstNode | Node, options: ProcessOptions = {}): AstStringifyResult {
    const normalized = normalizeProcessOptions(
      options as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    return JSON.parse(
      this.addon.stringify(encodeBoundaryAst(ast), JSON.stringify(normalized)),
    ) as AstStringifyResult;
  }

  private async resolveAnnotation(css: string, options: ProcessOptions): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const parsed = await this.parse(css, { from: options.from });
    return applyMapAnnotation(options, parsed.root);
  }
}
