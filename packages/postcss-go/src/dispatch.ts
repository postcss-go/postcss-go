import { materializePreviousMap, type ProcessFileOptions } from 'postcss-go-shared/map-options';

import { asProcessRoot, fromAst, Node, Root, toAst, type ProcessRoot } from './ast.js';
import { attachInputMetadata } from './input.js';
import {
  runPluginsWithBridge,
  runPluginsWithBridgeSync,
  type PluginResult,
  type ResultProcessorFacade,
  type RuntimePlugin,
} from './plugin-runtime.js';
import type { AcceptedPlugin } from './plugin-types.js';
import { hydrateResultMap, hydrateResultMessages, Result } from './result.js';
import type { PostcssGoService, SyncPostcssGoService } from './service.js';
import { prepareStringifyOptions } from './source-map-output.js';
import { assertSupportedSyntax, type SyntaxBearingOptions } from './syntax-options.js';
import type {
  AstNode,
  AstStringifyResult,
  DocumentNode,
  NoWorkResult,
  ProcessOptions,
  ProcessResult,
  RootNode,
} from './types.js';

export type DispatchAsyncService = Pick<
  PostcssGoService,
  'parse' | 'process' | 'stringify' | 'stringifyResult' | 'close'
> & {
  capabilities?: PostcssGoService['capabilities'];
  noWork?(css: string, options?: ProcessOptions): Promise<NoWorkResult>;
  parseLive?(css: string, options?: ProcessOptions): Promise<{ root: ProcessRoot }>;
  stringifyResultLive?(
    ast: AstNode | ProcessRoot,
    options?: ProcessOptions,
  ): Promise<AstStringifyResult>;
};

export type DispatchSyncService = Pick<
  SyncPostcssGoService,
  'parseSync' | 'processSync' | 'stringifySync' | 'stringifyResultSync'
> & {
  capabilities?: SyncPostcssGoService['capabilities'];
  noWorkSync?(css: string, options?: ProcessOptions): NoWorkResult;
};

/**
 * Shared policy gate: materialize map.prev and reject custom syntax extension
 * points before any service or plugin-runtime call that may narrow options.
 */
export function prepareDispatchOptions<
  T extends SyntaxBearingOptions & { from?: string; map?: unknown },
>(options: T): T {
  const prepared = materializePreviousMap(options);
  assertSupportedSyntax(prepared);
  return prepared;
}

/** PostCSS-shaped process: plugins → JS visitors; else → Go `process`. */
export async function dispatchProcess(
  service: DispatchAsyncService,
  css: string,
  options: ProcessFileOptions = {},
  plugins: AcceptedPlugin[] = [],
  processor?: ResultProcessorFacade,
): Promise<PluginResult> {
  options = prepareDispatchOptions(options);
  if (plugins.length > 0) {
    return runPluginsWithBridge(service, plugins, css, options, processor);
  }
  const processed = await service.process(css, options as ProcessOptions);
  return hydrateProcessResult(
    processed,
    css,
    options,
    processor ?? { plugins },
    processed.backend ?? service.capabilities?.backend,
  );
}

/** Synchronous twin of `dispatchProcess`. */
export function dispatchProcessSync(
  service: DispatchSyncService,
  css: string,
  options: ProcessFileOptions = {},
  plugins: AcceptedPlugin[] = [],
  processor?: ResultProcessorFacade,
): PluginResult {
  options = prepareDispatchOptions(options);
  if (plugins.length > 0) {
    return runPluginsWithBridgeSync(service, plugins, css, options, processor);
  }
  const processed = service.processSync(css, options as ProcessOptions);
  return hydrateProcessResult(
    processed,
    css,
    options,
    processor ?? { plugins },
    processed.backend ?? service.capabilities?.backend,
  );
}

export async function dispatchParse(
  service: Pick<PostcssGoService, 'parse'>,
  css: string,
  options: ProcessOptions = {},
): Promise<Root> {
  options = prepareDispatchOptions(options);
  const parsed = await service.parse(css, options);
  const root = asProcessRoot(fromAst(parsed.root));
  if (!(root instanceof Root)) throw new Error('postcss-go parse response is not a root');
  attachInputMetadata(root, css, options);
  return root;
}

export function dispatchParseSync(
  service: Pick<SyncPostcssGoService, 'parseSync'>,
  css: string,
  options: ProcessOptions = {},
): Root {
  options = prepareDispatchOptions(options);
  const root = asProcessRoot(service.parseSync(css, options).root);
  if (!(root instanceof Root)) throw new Error('postcss-go parseSync response is not a root');
  attachInputMetadata(root, css, options);
  return root;
}

export async function dispatchParseAst(
  service: Pick<PostcssGoService, 'parse'>,
  css: string,
  options: ProcessOptions = {},
): Promise<RootNode> {
  options = prepareDispatchOptions(options);
  return (await service.parse(css, options)).root;
}

export async function dispatchStringify(
  service: Pick<PostcssGoService, 'stringifyResult'>,
  node: Node,
  options: ProcessOptions = {},
): Promise<string> {
  options = prepareDispatchOptions(options);
  const effectiveOptions = prepareStringifyOptions(node, options);
  return (await service.stringifyResult(toAst(node), effectiveOptions)).css;
}

export function dispatchStringifySync(
  service: Pick<SyncPostcssGoService, 'stringifySync'>,
  node: Node,
  options: ProcessOptions = {},
): string {
  options = prepareDispatchOptions(options);
  const effectiveOptions = prepareStringifyOptions(node, options);
  return service.stringifySync(node, effectiveOptions);
}

export async function dispatchStringifyResult(
  service: Pick<PostcssGoService, 'stringifyResult'>,
  node: Node,
  options: ProcessOptions = {},
): Promise<AstStringifyResult> {
  options = prepareDispatchOptions(options);
  const effectiveOptions = prepareStringifyOptions(node, options);
  return service.stringifyResult(toAst(node), effectiveOptions);
}

export async function dispatchNoWork(
  service: Pick<PostcssGoService, 'noWork'>,
  css: string,
  options: ProcessOptions = {},
): Promise<NoWorkResult> {
  options = prepareDispatchOptions(options);
  return service.noWork(css, options);
}

export function dispatchNoWorkSync(
  service: Pick<SyncPostcssGoService, 'noWorkSync'>,
  css: string,
  options: ProcessOptions = {},
): NoWorkResult {
  options = prepareDispatchOptions(options);
  return service.noWorkSync(css, options);
}

/** Async process that returns a bridge DTO with a hydrated live root. */
export async function dispatchProcessDto(
  service: Pick<PostcssGoService, 'process'> & { capabilities?: PostcssGoService['capabilities'] },
  css: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  options = prepareDispatchOptions(options);
  const processed = await service.process(css, options);
  const root = asProcessRoot(
    processed.root instanceof Node
      ? processed.root
      : fromAst(processed.root as RootNode | DocumentNode),
  );
  attachInputMetadata(root, css, options);
  return {
    ...processed,
    backend: processed.backend ?? service.capabilities?.backend,
    root,
    messages: hydrateResultMessages(processed.messages),
  };
}

function hydrateProcessResult(
  processed: ProcessResult,
  css: string,
  options: ProcessFileOptions,
  processor: ResultProcessorFacade,
  backend?: PostcssGoService['capabilities']['backend'],
): PluginResult {
  const root = asProcessRoot(
    processed.root instanceof Node
      ? processed.root
      : fromAst(processed.root as RootNode | DocumentNode),
  );
  attachInputMetadata(root, css, options as ProcessOptions);
  const result = new Result<RuntimePlugin>(processor, root, options);
  result.css = processed.css;
  result.map = hydrateResultMap(processed.map);
  result.mapFile = processed.mapFile;
  result.backend = backend;
  result.messages.push(...hydrateResultMessages(processed.messages));
  return result;
}
