import { UnsupportedServiceError, type PostcssGoService } from './service.js';
import type { AstNode, ParseResult, ProcessOptions, ProcessResult } from './types.js';

export interface BrowserPostcssGoServiceOptions {
  workerUrl?: string;
  wasmUrl?: string;
}

export class BrowserPostcssGoService implements PostcssGoService {
  readonly workerUrl?: string;
  readonly wasmUrl?: string;

  constructor(options: BrowserPostcssGoServiceOptions = {}) {
    this.workerUrl = options.workerUrl;
    this.wasmUrl = options.wasmUrl;
  }

  async parse(_css: string, _options: ProcessOptions = {}): Promise<ParseResult> {
    throw new UnsupportedServiceError(
      'BrowserPostcssGoService.parse is not implemented yet. The future implementation will run the Go engine in a worker/wasm environment.',
    );
  }

  async process(_css: string, _options: ProcessOptions = {}): Promise<ProcessResult> {
    throw new UnsupportedServiceError(
      'BrowserPostcssGoService.process is not implemented yet. The future implementation will run the Go engine in a worker/wasm environment.',
    );
  }

  async stringify(_ast: AstNode): Promise<string> {
    throw new UnsupportedServiceError(
      'BrowserPostcssGoService.stringify is not implemented yet. The future implementation will run the Go engine in a worker/wasm environment.',
    );
  }

  async close(): Promise<void> {}
}
