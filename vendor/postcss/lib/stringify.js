"use strict";
const bridge_1 = require("./bridge");
function dtoOf(node, includeInput = false, materializeRaw = true, context = { nextId: 0 }) {
    const dto = { type: node.type, raws: { ...(node.raws || {}) } };
    context.nextId += 1;
    // Direct node.toString() calls do not serialize the parent. Materialize
    // PostCSS's formatting samples while the parent is still available.
    if (materializeRaw && node.raw && node.parent) {
        const keys = ['before', 'between', 'semicolon'];
        if (node.nodes && node.nodes.length > 0) {
            keys.push('after');
        }
        else if (node.parent && Array.isArray(node.parent.nodes)) {
            const siblingsWithEmptyBody = node.parent.nodes?.filter((sibling) => sibling !== node && sibling.nodes?.length === 0 && sibling.raws?.after !== undefined);
            if (siblingsWithEmptyBody?.length) {
                const emptyBody = siblingsWithEmptyBody.find((sibling) => sibling.raws?.after === '');
                dto.raws.after = emptyBody ? '' : node.raw?.('after');
            }
        }
        for (const key of keys) {
            if (!(key in dto.raws)) {
                const value = node.raw(key);
                if (value !== undefined)
                    dto.raws[key] = value;
            }
        }
    }
    if (node.source) {
        const input = node.source.input;
        dto.source = {
            start: { ...node.source.start },
            end: { ...node.source.end },
            file: input?.file || '',
            ...(includeInput
                ? {
                    css: input?.css || '',
                    map: input?.map?.text || '',
                    mapUrl: input?.map?.mapFile || input?.file || '',
                }
                : {}),
        };
    }
    switch (node.type) {
        case 'document':
        case 'root':
            break;
        case 'rule':
            dto.selector = String(node.selector ?? '');
            break;
        case 'atrule':
            dto.name = String(node.name ?? '');
            dto.params = String(node.params ?? '');
            dto.block = Boolean(node.nodes);
            break;
        case 'decl':
            dto.prop = String(node.prop ?? '');
            dto.value = String(node.value ?? '');
            dto.important = Boolean(node.important);
            break;
        case 'comment':
            dto.text = String(node.text ?? '');
            break;
        default:
            throw new Error(`Unsupported PostCSS AST node type: ${node.type}`);
    }
    if (node.nodes)
        dto.nodes = node.nodes.map((child) => dtoOf(child, false, false, context));
    return dto;
}
function flattenNodes(node, result = []) {
    result.push(node);
    if (node.nodes)
        for (const child of node.nodes)
            flattenNodes(child, result);
    return result;
}
function stringify(node, builder) {
    const result = (0, bridge_1.call)('stringify', {
        ast: dtoOf(node, true),
        builder: Boolean(builder),
    });
    if (builder) {
        const nodes = flattenNodes(node);
        if (result.parts?.length) {
            for (const part of result.parts) {
                builder(part.css, part.node ? nodes[part.node - 1] : undefined, part.type);
            }
        }
        else {
            builder(result.css, node);
        }
        return;
    }
    return result.css;
}
stringify.default = stringify;
module.exports = stringify;
