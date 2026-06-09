import type { AstNode, ParseResult, ProcessOptions, ProcessResult } from './types.js';

export interface PostcssGoService {
  parse(css: string, options?: ProcessOptions): Promise<ParseResult>;
  process(css: string, options?: ProcessOptions): Promise<ProcessResult>;
  stringify(ast: AstNode): Promise<string>;
  close(): Promise<void>;
}

export class UnsupportedServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedServiceError';
  }
}
