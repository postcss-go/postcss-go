import { Document, asProcessRoot, fromAst, Root, toAst, type Node } from './ast.js';
import { createNodeService } from './node.js';
import type { PostcssGoService } from './service.js';
import type {
  DocumentNode,
  ProcessOptions,
  ProcessResult,
  RootNode,
  Warning,
} from './types.js';
import { attachInputMetadata } from './input.js';
import { assertSupportedSyntax } from './syntax-options.js';
import { prepareStringifyOptions } from './source-map-output.js';

export interface DocumentResult {
  css: string;
  map?: string;
  root: DocumentNode | RootNode;
  messages: Warning[];
}

export async function parse(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<Root> {
  assertSupportedSyntax(options);
  const activeService = service ?? createNodeService();
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
  assertSupportedSyntax(options);
  const activeService = service ?? createNodeService();
  try {
    const processed = await activeService.process(css, options);
    const root = asProcessRoot(fromAst(processed.root as RootNode | DocumentNode));
    attachInputMetadata(root, css, options);
    return { ...processed, root };
  } finally {
    if (!service) {
      await activeService.close();
    }
  }
}

export async function parseAst(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<Root> {
  return parse(css, options, service);
}

/** Explicit asynchronous stringifier. */
export async function stringify(
  node: Node,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<string> {
  assertSupportedSyntax(options);
  const activeService = service ?? createNodeService();
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
  assertSupportedSyntax(options);
  const activeService = service ?? createNodeService();
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
  const activeService = service ?? createNodeService();
  try {
    return await activeService.stringify(toAst(root));
  } finally {
    if (!service) await activeService.close();
  }
}

/**
 * Stringify an existing Document and optionally generate a source map. Mapping
 * is delegated to the CSS process path because the bridge process endpoint
 * accepts CSS, while the returned root remains the original Document DTO.
 */
export async function toResult(
  document: Document | Root,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<DocumentResult> {
  assertSupportedSyntax(options);
  const activeService = service ?? createNodeService();
  try {
    const ast = toAst(document) as DocumentNode | RootNode;
    const css = await activeService.stringify(ast);
    if (!options.map) return { css, root: ast, messages: [] };

    const processed = await activeService.process(css, options);
    return {
      css: processed.css,
      map: processed.map,
      root: ast,
      messages: processed.messages,
    };
  } finally {
    if (!service) await activeService.close();
  }
}
