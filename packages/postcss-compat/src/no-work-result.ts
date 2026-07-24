import {
  applyMapAnnotation,
  normalizeProcessOptions,
  type MapOptions,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';
import { call } from './bridge';
import path from 'node:path';

// Sibling PostCSS lib modules exist only after these files are copied into
// vendor/postcss/lib by the upstream compat prepare script.
const load = (id: string): any => require(id);
const parse = load('./parse');
const Result = load('./result');
const { SourceMapConsumer, SourceMapGenerator } = load('source-map-js');
const warnOnce = load('./warn-once');

function resolveAnnotationPath(to: string | undefined, annotation: string): string {
  return path.resolve(joinMapAnnotationPath(to, annotation));
}

function toBridgeOptions(opts: Record<string, unknown>) {
  // NoWorkResult historically passes an undefined root into annotation callbacks.
  const applied = applyMapAnnotation(
    {
      from: opts.from as string | undefined,
      to: opts.to as string | undefined,
      map: opts.map as MapOptions | boolean | undefined,
    },
    undefined,
  );
  return normalizeProcessOptions(applied, resolveAnnotationPath);
}

function asSourceMap(json: string) {
  return SourceMapGenerator.fromSourceMap(new SourceMapConsumer(json), {
    ignoreInvalidMapping: true,
  });
}

class NoWorkResult {
  stringified: boolean;
  _processor: unknown;
  _css: string;
  _opts: Record<string, unknown>;
  _map: unknown;
  _root?: unknown;
  error?: unknown;
  result: any;

  get content() {
    return this.result.css;
  }
  get css() {
    return this.result.css;
  }
  get map() {
    return this.result.map;
  }
  get messages() {
    return [];
  }
  get opts() {
    return this.result.opts;
  }
  get processor() {
    return this.result.processor;
  }
  get root() {
    if (this._root) return this._root;
    const parser = parse;
    try {
      this._root = parser(this._css, this._opts);
    } catch (error) {
      this.error = error;
    }
    if (this.error) throw this.error;
    return this._root;
  }
  get [Symbol.toStringTag]() {
    return 'NoWorkResult';
  }

  constructor(processor: unknown, css: { toString(): string }, opts: Record<string, unknown>) {
    const cssText = css.toString();
    this.stringified = false;
    this._processor = processor;
    this._css = cssText;
    this._opts = opts;
    this._map = undefined;
    this.result = new Result(this._processor, undefined, this._opts);
    this.result.css = cssText;
    Object.defineProperty(this.result, 'root', {
      get: () => this.root,
    });

    // Go owns no-work map generation, previous-map composition, annotation
    // cleanup, and annotation emission without parsing CSS.
    const processed = call('noWork', {
      css: cssText,
      options: toBridgeOptions(opts),
    }) as {
      css: string;
      map?: string;
    };
    this.result.css = processed.css;
    if (processed.map) this.result.map = asSourceMap(processed.map);
  }

  async() {
    return this.error ? Promise.reject(this.error) : Promise.resolve(this.result);
  }
  catch(onRejected: (reason: unknown) => unknown) {
    return this.async().catch(onRejected);
  }
  finally(onFinally: () => unknown) {
    return this.async().then(onFinally, onFinally);
  }
  sync() {
    if (this.error) throw this.error;
    return this.result;
  }
  then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
    if (process.env.NODE_ENV !== 'production' && !('from' in this._opts)) {
      warnOnce(
        'Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning.',
      );
    }
    return this.async().then(onFulfilled, onRejected);
  }
  toString() {
    return this._css;
  }
  warnings() {
    return [];
  }
}

(NoWorkResult as any).default = NoWorkResult;
export = NoWorkResult;
