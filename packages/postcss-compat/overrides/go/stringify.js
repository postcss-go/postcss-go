'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const { call } = require('./bridge');

function dtoOf(node) {
  const dto = { type: node.type, raws: node.raws || {} };
  switch (node.type) {
    case 'document':
    case 'root':
      break;
    case 'rule':
      dto.selector = node.selector;
      break;
    case 'atrule':
      dto.name = node.name;
      dto.params = node.params || '';
      dto.block = Boolean(node.nodes);
      break;
    case 'decl':
      dto.prop = node.prop;
      dto.value = node.value;
      dto.important = Boolean(node.important);
      break;
    case 'comment':
      dto.text = node.text;
      break;
    default:
      throw new Error(`Unsupported PostCSS AST node type: ${node.type}`);
  }
  if (node.nodes) dto.nodes = node.nodes.map(dtoOf);
  return dto;
}

function stringify(node, builder) {
  const result = call('stringify', { ast: dtoOf(node) });
  if (builder) builder(result.css, node);
  return result.css;
}

module.exports = stringify;
stringify.default = stringify;
