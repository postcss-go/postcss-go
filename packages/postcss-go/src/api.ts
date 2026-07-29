import { Document, asProcessRoot, fromAst, Node, Root, toAst, type ProcessRoot } from './ast.js';
import { materializePreviousMap } from '@postcss-go/shared/map-options';
import { createDefaultAsyncService } from './native.js';
import type { PostcssGoService } from './service.js';
import type { DocumentNode, ProcessOptions, ProcessResult, RootNode, ResultMessage } from './types.js';
import { attachInputMetadata } from './input.js';
import { prepareStringifyOptions } from './source-map-output.js';
import { hydrateResultMap, hydrateResultMessages, type ResultMap } from './result.js';

export interface DocumentResult {
  css: string;
  map?: ResultMap;
  mapFile?: string;
  root: ProcessRoot;
  messages: ResultMessage[];
}

export async function parse(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<Root> {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    const parsed = await activeService.parse(css, options);
    const root = asProcessRoot(fromAst(parsed.root));
    if (!(root instanceof Root)) throw new Error('postcss-go parse response is not a root');
    attachInputMetadata(root, css, options);
    return root;
  } finally {
    if (!service) {
      await activeService.close();
    }
  }
}

export async function process(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<ProcessResult> {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    const processed = await activeService.process(css, options);
    const root = asProcessRoot(
      processed.root instanceof Node
        ? processed.root
        : fromAst(processed.root as RootNode | DocumentNode),
    );
    attachInputMetadata(root, css, options);
    return {
      ...processed,
      root,
      messages: hydrateResultMessages(processed.messages),
    };
  } finally {
    if (!service) {
      await activeService.close();
    }
  }
}

/** Parse CSS into a serializable Go AST DTO (no live-node hydration). */
export async function parseAst(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<RootNode> {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    return (await activeService.parse(css, options)).root;
  } finally {
    if (!service) await activeService.close();
  }
}

/** Explicit asynchronous stringifier. */
export async function stringify(
  node: Node,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<string> {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    const effectiveOptions = prepareStringifyOptions(node, options);
    return (await activeService.stringifyResult(toAst(node), effectiveOptions)).css;
  } finally {
    if (!service) await activeService.close();
  }
}

/** Explicit asynchronous no-plugin source-map path. */
export async function noWork(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
) {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await activeService.noWork(css, options);
  } finally {
    if (!service) await activeService.close();
  }
}

export async function stringifyAst(
  root: Root | Document,
  service?: PostcssGoService,
): Promise<string> {
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await activeService.stringify(toAst(root));
  } finally {
    if (!service) await activeService.close();
  }
}

/**
 * Stringify an existing Document or Root and optionally generate a source map.
 * Mapping uses `stringifyResult` so Document structure is preserved; the returned
 * `root` is the same live node instance passed in.
 */
export async function toResult(
  document: Document | Root,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<DocumentResult> {
  options = materializePreviousMap(options);
  const activeService = service ?? createDefaultAsyncService();
  try {
    const root = asProcessRoot(document);
    const effectiveOptions = prepareStringifyOptions(root, options);
    const stringified = await activeService.stringifyResult(toAst(root), effectiveOptions);
    return {
      css: stringified.css,
      map: hydrateResultMap(stringified.map),
      mapFile: stringified.mapFile,
      root,
      messages: [],
    };
  } finally {
    if (!service) await activeService.close();
  }
}
