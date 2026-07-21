'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const AtRule = require('./at-rule');
const Comment = require('./comment');
const Container = require('./container');
const Declaration = require('./declaration');
const Input = require('./input');
const Root = require('./root');
const Rule = require('./rule');
const { call } = require('./bridge');

function sourceOf(dto, input) {
  if (!dto) return undefined;
  const source = {
    start: { ...dto.start },
    end: { ...dto.end },
    input,
  };
  return source;
}

function nodeOf(dto, input) {
  const defaults = { raws: dto.raws || {} };
  if (dto.source) {
    defaults.source = sourceOf(dto.source, input);
    if (dto.type === 'atrule' && !dto.params && dto.source.start.offset === dto.source.end.offset) {
      delete defaults.source.end;
    }
  }

  let node;
  switch (dto.type) {
    case 'root':
      node = new Root(defaults);
      break;
    case 'rule':
      node = new Rule({ ...defaults, selector: dto.selector || '' });
      break;
    case 'atrule':
      node = new AtRule({
        ...defaults,
        name: dto.name,
        params: dto.params || '',
        ...(dto.block ? { nodes: [] } : {}),
      });
      break;
    case 'decl':
      node = new Declaration({
        ...defaults,
        prop: dto.prop,
        value: dto.value,
        important: dto.important,
      });
      break;
    case 'comment':
      node = new Comment({ ...defaults, text: dto.text });
      break;
    default:
      throw new Error(`Unsupported Go AST node type: ${dto.type}`);
  }

  if (dto.nodes && dto.nodes.length) {
    node.append(dto.nodes.map((child) => nodeOf(child, input)));
  }
  return node;
}

const trailingSourceMapAnnotation = /(?:\r?\n|\s)*\/\*#\s*sourceMappingURL=[\s\S]*?\*\/\s*$/;

function cssWithoutSourceMapAnnotation(css) {
  return css.replace(trailingSourceMapAnnotation, '');
}

function usablePreviousMap(input) {
  const text = input.map?.text || '';
  if (!text) return '';
  try {
    const map = JSON.parse(text);
    if (typeof map.mappings === 'string') return map.mappings ? text : '';
    return Array.isArray(map.sections) && map.sections.length ? text : '';
  } catch {
    return '';
  }
}

module.exports = function parse(css, opts = {}) {
  const text = css == null ? css : css.toString();
  const input = new Input(text, opts);
  // Custom syntax runs through the normal stringify path, where the
  // annotation is removed by PostCSS's map generator. Keep it in the normal
  // path so the standard annotation and source-map tests retain their raw
  // formatting semantics.
  const parseText = opts.syntax || opts.parser ? cssWithoutSourceMapAnnotation(text) : text;
  const result = call('parse', {
    css: parseText,
    options: {
      from: input.file || opts.from || '',
      previousMap: usablePreviousMap(input),
      previousMapUrl: input.map?.mapFile || input.file || '',
    },
  });
  return nodeOf(result.root, input);
};

module.exports.default = module.exports;
Container.registerParse(module.exports);
