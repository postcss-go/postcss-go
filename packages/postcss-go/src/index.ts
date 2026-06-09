import { NodePostcssGoService, type NodePostcssGoServiceOptions } from './node.js';
import type { PostcssGoService } from './service.js';
import type { ParseResult, ProcessOptions, ProcessResult } from './types.js';

export { BrowserPostcssGoService } from './browser.js';
export { NodePostcssGoService } from './node.js';
export { UnsupportedServiceError, type PostcssGoService } from './service.js';
export type {
  AstNode,
  AtRuleNode,
  CommentNode,
  DeclarationNode,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  RootNode,
  RuleNode,
  SourceLocation,
  SourcePosition,
  Warning,
} from './types.js';

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

export function createNodeService(options: NodePostcssGoServiceOptions = {}): NodePostcssGoService {
  return new NodePostcssGoService(options);
}
