'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const { call } = require('./bridge');
const Stringifier = require('./stringifier');

function dtoOf(node, includeInput = false) {
  const dto = { type: node.type, raws: node.raws || {} };
  if (node.source) {
    const input = node.source.input;
    dto.source = {
      start: { ...node.source.start },
      end: { ...node.source.end },
      file: input?.file || '',
      ...(includeInput ? {
        css: input?.css || '',
        map: input?.map?.text || '',
        mapUrl: input?.map?.mapFile || input?.file || '',
      } : {}),
    };
  }
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
  if (node.nodes) dto.nodes = node.nodes.map((child) => dtoOf(child));
  return dto;
}

function stringify(node, builder) {
  // PostCSS's map generator relies on the per-node callback contract. The Go
  // RPC returns a complete string, so keep the native stringifier for that
  // callback path and use Go for the public, no-builder path.
  if (builder) {
    const stringifier = new Stringifier(builder);
    return stringifier.stringify(node);
  }
  const result = call('stringify', { ast: dtoOf(node, true) });
  return result.css;
}

module.exports = stringify;
stringify.default = stringify;
