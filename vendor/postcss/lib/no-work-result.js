"use strict";
// Sibling PostCSS lib modules exist only after these files are copied into
// vendor/postcss/lib by the upstream compat prepare script.
const load = (id) => require(id);
const MapGenerator = load('./map-generator');
const parse = load('./parse');
const Result = load('./result');
const stringify = load('./stringify');
const warnOnce = load('./warn-once');
function hasSourceMapAnnotation(css) {
    return /\/\*#\s*sourceMappingURL=/.test(css);
}
function normalizeGeneratedCSS(css, hadAnnotation, mapped) {
    if (!hadAnnotation)
        return css;
    if (!mapped)
        return css.replace(/\n+$/, '');
    return css.replace(/\n{2}(\/\*#\s*sourceMappingURL=)/, '\n$1');
}
class NoWorkResult {
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
        if (this._root)
            return this._root;
        const parser = parse;
        try {
            this._root = parser(this._css, this._opts);
        }
        catch (error) {
            this.error = error;
        }
        if (this.error)
            throw this.error;
        return this._root;
    }
    get [Symbol.toStringTag]() {
        return 'NoWorkResult';
    }
    constructor(processor, css, opts) {
        const cssText = css.toString();
        this.stringified = false;
        this._processor = processor;
        this._css = cssText;
        this._opts = opts;
        this._map = undefined;
        const hadAnnotation = hasSourceMapAnnotation(cssText);
        const str = stringify;
        this.result = new Result(this._processor, undefined, this._opts);
        this.result.css = cssText;
        Object.defineProperty(this.result, 'root', {
            get: () => this.root,
        });
        const map = new MapGenerator(str, undefined, this._opts, cssText);
        if (map.isMap()) {
            const [generatedCSS, generatedMap] = map.generate();
            if (generatedCSS)
                this.result.css = generatedCSS;
            if (generatedMap)
                this.result.map = generatedMap;
            this.result.css = normalizeGeneratedCSS(this.result.css, hadAnnotation, true);
        }
        else {
            map.clearAnnotation();
            this.result.css = normalizeGeneratedCSS(map.css, hadAnnotation, false);
        }
    }
    async() {
        return this.error ? Promise.reject(this.error) : Promise.resolve(this.result);
    }
    catch(onRejected) {
        return this.async().catch(onRejected);
    }
    finally(onFinally) {
        return this.async().then(onFinally, onFinally);
    }
    sync() {
        if (this.error)
            throw this.error;
        return this.result;
    }
    then(onFulfilled, onRejected) {
        if (process.env.NODE_ENV !== 'production' && !('from' in this._opts)) {
            warnOnce('Without `from` option PostCSS could generate wrong source map and will not find Browserslist config. Set it to CSS file path or to `undefined` to prevent this warning.');
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
NoWorkResult.default = NoWorkResult;
module.exports = NoWorkResult;
