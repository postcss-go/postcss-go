import { Document, fromAst, Root, toAst } from './ast.js';
import { createNodeService, NodePostcssGoService } from './node.js';
import type { PostcssGoService } from './service.js';
import type {
  DocumentNode,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  RootNode,
  Warning,
} from './types.js';

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
): Promise<ParseResult> {
  const activeService = service ?? new NodePostcssGoService();
  try {
    return await activeService.parse(css, options);
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
  const activeService = service ?? new NodePostcssGoService();
  try {
    return await activeService.process(css, options);
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
  const activeService = service ?? createNodeService();
  try {
    const result: ParseResult = await activeService.parse(css, options);
    const root = fromAst(result.root);
    if (!(root instanceof Root)) throw new Error('postcss-go parse response is not a root');
    return root;
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
