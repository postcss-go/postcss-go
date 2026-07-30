import { Document, asProcessRoot, Node, Root, toAst, type ProcessRoot } from './ast.js';
import { createDefaultAsyncService } from './native.js';
import type { PostcssGoService } from './service.js';
import type { ProcessOptions, ProcessResult, RootNode } from './types.js';
import { hydrateResultMap, Result, type ResultMap } from './result.js';
import {
  dispatchNoWork,
  dispatchParse,
  dispatchParseAst,
  dispatchProcessDto,
  dispatchStringify,
  dispatchStringifyResult,
} from './dispatch.js';

export type DocumentResult = Result & {
  mapFile?: string;
};

export async function parse(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<Root> {
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchParse(activeService, css, options);
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
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchProcessDto(activeService, css, options);
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
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchParseAst(activeService, css, options);
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
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchStringify(activeService, node, options);
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
  const activeService = service ?? createDefaultAsyncService();
  try {
    return await dispatchNoWork(activeService, css, options);
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
  const activeService = service ?? createDefaultAsyncService();
  try {
    const root = asProcessRoot(document);
    const stringified = await dispatchStringifyResult(activeService, root, options);
    const result = new Result({ plugins: [] }, root, options as never) as DocumentResult;
    result.css = stringified.css;
    result.map = hydrateResultMap(stringified.map);
    result.mapFile = stringified.mapFile;
    return result;
  } finally {
    if (!service) await activeService.close();
  }
}
