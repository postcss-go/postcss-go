'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const AtRule = require('./at-rule');
const Comment = require('./comment');
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

module.exports = function parse(css, opts = {}) {
  const text = css == null ? css : css.toString();
  const result = call('parse', { css: text, options: { from: opts.from || '' } });
  const input = new Input(text, opts);
  return nodeOf(result.root, input);
};
