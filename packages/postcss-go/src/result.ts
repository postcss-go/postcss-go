import type { Root } from './ast.js';
import type { ProcessFileOptions } from '@postcss-go/shared/map-options';
import { Warning, type WarningOptions } from './warning.js';

export interface ResultProcessor<P = unknown> {
  plugins: P[];
}

/** Mutable processing result shared with plugin callbacks. */
export class Result<P = unknown> {
  css = '';
  map?: string;
  root: Root;
  messages: Array<Record<string, unknown>> = [];
  opts: ProcessFileOptions;
  processor: ResultProcessor<P>;
  lastPlugin?: P;

  constructor(processor: ResultProcessor<P>, root: Root, opts: ProcessFileOptions = {}) {
    this.processor = processor;
    this.root = root;
    this.opts = opts;
  }

  get content(): string {
    return this.css;
  }

  warnings(): Warning[] {
    return this.messages.filter((message) => message.type === 'warning') as Warning[];
  }

  warn(text: string, options: WarningOptions = {}): Warning {
    const plugin =
      options.plugin ??
      (typeof this.lastPlugin === 'object' && this.lastPlugin
        ? (this.lastPlugin as { postcssPlugin?: string }).postcssPlugin
        : undefined);
    const warning = new Warning(text, { ...options, plugin });
    this.messages.push(warning);
    return warning;
  }

  toString(): string {
    return this.css;
  }
}
