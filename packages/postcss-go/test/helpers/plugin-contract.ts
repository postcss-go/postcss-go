import { expect } from 'vitest';

import type { Declaration, Rule } from '../../src/ast.ts';
import type { AcceptedPlugin } from '../../src/plugin-types.ts';
import type { PluginHelpers, PluginResult } from '../../src/plugin-runtime.ts';

export const pluginContractFrom = 'plugin-contract.css';
export const pluginContractTo = 'plugin-contract.out.css';

export const willChangeCss = 'a {\n  will-change: transform;\n}\n';

export const nestedMutationCss = '.card {\n  color: red;\n  .title { font-weight: bold; }\n}\n';

export const asyncColorCss = '.x { color: red }';

/** Mutation-heavy visitor modeled on the PostCSS will-change example plugin. */
export const willChangePlugin: AcceptedPlugin = {
  postcssPlugin: 'will-change',
  Declaration(node: Declaration) {
    if (node.prop !== 'will-change') return;
    if (!node.parent) return;
    const already = node.parent.some(
      (child) => child.type === 'decl' && (child as Declaration).prop === 'backface-visibility',
    );
    if (already) return;
    node.cloneBefore({ prop: 'backface-visibility', value: 'hidden' });
  },
};

/** Unwraps one level of nested rules using object-literal node construction. */
export const nestedMutationPlugin: AcceptedPlugin = {
  postcssPlugin: 'nested-mutation',
  Rule(rule: Rule) {
    const nested = (rule.nodes ?? []).filter((child): child is Rule => child.type === 'rule');
    if (nested.length === 0) return;
    for (const child of nested) {
      child.selector = `${rule.selector} ${child.selector}`;
      rule.after(child);
    }
    if ((rule.nodes ?? []).every((child) => child.type !== 'decl')) rule.remove();
  },
};

export const asyncColorPlugin: AcceptedPlugin = {
  postcssPlugin: 'async-to-navy',
  async Declaration(decl: Declaration) {
    await Promise.resolve();
    if (decl.prop === 'color') decl.value = 'navy';
  },
};

export function createContextPlugin(events: string[]): AcceptedPlugin {
  return {
    postcssPlugin: 'context-probe',
    prepare(result: PluginResult) {
      const parent = result.opts.from;
      result.messages.push({ type: 'dependency', file: 'tokens.css', parent });
      result.messages.push({
        type: 'dir-dependency',
        dir: 'components',
        glob: '**/*.css',
        parent,
      });
      return {
        Once(root: PluginResult['root'], helpers: PluginHelpers) {
          events.push('once');
          expectContext(root, helpers);
          helpers.result.warn('from-result');
        },
        Declaration(decl: Declaration, helpers: PluginHelpers) {
          events.push(`decl:${decl.prop}`);
          if (decl.prop === 'color') decl.warn(helpers.result, 'checked');
        },
        OnceExit(_root: PluginResult['root'], helpers: PluginHelpers) {
          events.push('once-exit');
          expect(helpers.result.lastPlugin).toEqual(
            expect.objectContaining({ postcssPlugin: 'context-probe' }),
          );
        },
      };
    },
  };
}

function expectContext(root: PluginResult['root'], helpers: PluginHelpers): void {
  const { result } = helpers;
  expect(result.root).toBe(root);
  expect(result.opts.from).toBe(pluginContractFrom);
  expect(result.opts.to).toBe(pluginContractTo);
  expect(root.source?.input?.css).toBeTruthy();
  expect(typeof helpers.rule).toBe('function');
  expect(typeof helpers.result.warn).toBe('function');
}
