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
  service: PostcssGoService = new NodePostcssGoService(),
): Promise<ParseResult> {
  return service.parse(css, options);
}

export async function process(
  css: string,
  options: ProcessOptions = {},
  service: PostcssGoService = new NodePostcssGoService(),
): Promise<ProcessResult> {
  return service.process(css, options);
}

export function createNodeService(options: NodePostcssGoServiceOptions = {}): NodePostcssGoService {
  return new NodePostcssGoService(options);
}
