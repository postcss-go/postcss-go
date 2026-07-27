import type { AcceptedPlugin } from 'postcss';
import postcss from 'postcss';
import type { ProcessFileOptions } from '@postcss-go/shared/map-options';

import {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  fromAst,
  fromJSON,
  Node,
  Root,
  Rule,
  toAst,
} from './ast.js';
import type { PostcssGoService } from './service.js';
import type { AstNode as AstDTO, ProcessOptions } from './types.js';

type PluginBridgeService = Pick<PostcssGoService, 'parse' | 'stringifyResult'>;

type Message = Record<string, unknown> & { type?: string; text?: string };
type Listener = (node: Node, helpers: PluginHelpers) => unknown;
type ListenerGroup = Listener | Record<string, Listener | undefined>;
type RuntimePlugin = {
  postcssPlugin?: string;
  plugins?: AcceptedPlugin[];
  postcss?: unknown;
  prepare?: (result: PluginResult) => Record<string, unknown> | void;
  Once?: Listener;
  OnceExit?: Listener;
  Document?: ListenerGroup;
  DocumentExit?: ListenerGroup;
  Root?: ListenerGroup;
  RootExit?: ListenerGroup;
  Rule?: ListenerGroup;
  RuleExit?: ListenerGroup;
  AtRule?: ListenerGroup;
  AtRuleExit?: ListenerGroup;
  Declaration?: ListenerGroup;
  DeclarationExit?: ListenerGroup;
  Comment?: ListenerGroup;
  CommentExit?: ListenerGroup;
  [key: string]: unknown;
};

export interface PluginResult {
  css: string;
  map?: string;
  root: Root;
  messages: Message[];
  opts: ProcessFileOptions;
  processor: { plugins: RuntimePlugin[] };
  lastPlugin?: RuntimePlugin;
  readonly content: string;
  warnings(): Message[];
  warn(text: string, options?: Record<string, unknown>): Message;
  toString(): string;
}

type PluginHelpers = {
  result: PluginResult;
  postcss: typeof postcssApi;
};

const list = {
  comma(value: string): string[] {
    return list.split(value, [','], true);
  },
  space(value: string): string[] {
    return list.split(value, [' ', '\n', '\t']);
  },
  split(value: string, separators: string[], last?: boolean): string[] {
    const array: string[] = [];
    let current = '';
    let split = false;
    let func = 0;
    let inQuote = false;
    let prevQuote = '';
    let escape = false;

    for (const letter of value) {
      if (escape) {
        escape = false;
      } else if (letter === '\\') {
        escape = true;
      } else if (inQuote) {
        if (letter === prevQuote) inQuote = false;
      } else if (letter === '"' || letter === "'") {
        inQuote = true;
        prevQuote = letter;
      } else if (letter === '(') {
        func += 1;
      } else if (letter === ')') {
        if (func > 0) func -= 1;
      } else if (func === 0 && separators.includes(letter)) {
        split = true;
      }

      if (split) {
        if (current !== '') array.push(current.trim());
        current = '';
        split = false;
      } else {
        current += letter;
      }
    }

    if (last || current !== '') array.push(current.trim());
    return array;
  },
};

const postcssApi = {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  Node,
  Root,
  Rule,
  list,
  fromJSON,
  parse(css: string, opts?: Parameters<typeof postcss.parse>[1]) {
    return fromAst(postcss.parse(css, opts).toJSON() as AstDTO);
  },
  stringify(node: Node, builder?: (chunk: string, node?: Node, type?: string) => void) {
    if (!builder) return node.toString();
    builder(node.toString(), node);
  },
  atRule: (defaults: ConstructorParameters<typeof AtRule>[0] = {}) => new AtRule(defaults),
  comment: (defaults: ConstructorParameters<typeof Comment>[0] = {}) => new Comment(defaults),
  decl: (defaults: ConstructorParameters<typeof Declaration>[0] = {}) => new Declaration(defaults),
  document: (defaults: ConstructorParameters<typeof Document>[0] = {}) => new Document(defaults),
  root: (defaults: ConstructorParameters<typeof Root>[0] = {}) => new Root(defaults),
  rule: (defaults: ConstructorParameters<typeof Rule>[0] = {}) => new Rule(defaults),
};

let hasInstancePatched = false;

function ordinaryHasInstance(ctor: { prototype: object }, value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  let proto = Object.getPrototypeOf(value);
  const target = ctor.prototype;
  while (proto) {
    if (proto === target) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

function patchHasInstance(ctor: { prototype: object }, match: (value: unknown) => boolean): void {
  Object.defineProperty(ctor, Symbol.hasInstance, {
    configurable: true,
    value(value: unknown) {
      if (match(value)) return true;
      return ordinaryHasInstance(ctor, value);
    },
  });
}

/** Make `instanceof postcss.Rule` (etc.) succeed for postcss-go AST nodes. */
function ensurePostcssInstanceofCompat(): void {
  if (hasInstancePatched) return;
  hasInstancePatched = true;
  patchHasInstance(postcss.Node, (value) => value instanceof Node);
  patchHasInstance(postcss.Container, (value) => value instanceof Container);
  patchHasInstance(postcss.Root, (value) => value instanceof Root);
  patchHasInstance(postcss.Document, (value) => value instanceof Document);
  patchHasInstance(postcss.Rule, (value) => value instanceof Rule);
  patchHasInstance(postcss.AtRule, (value) => value instanceof AtRule);
  patchHasInstance(postcss.Declaration, (value) => value instanceof Declaration);
  patchHasInstance(postcss.Comment, (value) => value instanceof Comment);
}

/**
 * Runs JavaScript plugin callbacks around the Go AST bridge. Go owns parsing
 * on the way in; this runtime owns plugin lifecycle, AST-based source maps for
 * the plugin phase, and leaves final map annotation/composition to the engine.
 */
export async function runPluginsWithBridge(
  service: PluginBridgeService,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
): Promise<PluginResult> {
  ensurePostcssInstanceofCompat();
  const normalized = normalizePlugins(plugins);
  const parsed = await service.parse(css, { from: options.from });
  const hydrated = fromAst(parsed.root);
  if (!(hydrated instanceof Root)) {
    throw new Error('postcss-go plugin bridge parse response is not a root');
  }
  attachPreviousMapMetadata(hydrated, css, options);

  const result = createResult(hydrated, options, normalized);
  const activePlugins = normalized.map((plugin) => {
    const prepared = plugin.prepare?.(result);
    return prepared ? { ...plugin, ...prepared } : plugin;
  });
  const helpers: PluginHelpers = { result, postcss: postcssApi };
  const listeners = prepareVisitors(activePlugins);

  for (const plugin of activePlugins) {
    await runListener(plugin, plugin.Once, hydrated, helpers);
  }

  while (!hydrated.isClean) {
    hydrated.markClean();
    await visitNode(hydrated, listeners, helpers);
  }

  for (const plugin of activePlugins) {
    await runListener(plugin, plugin.OnceExit, hydrated, helpers);
  }

  const stringified = await service.stringifyResult(toAst(hydrated), options as ProcessOptions);
  result.css = stringified.css;
  result.map = stringified.map;
  return result;
}

function createResult(
  root: Root,
  opts: ProcessFileOptions,
  plugins: RuntimePlugin[],
): PluginResult {
  const result: PluginResult = {
    css: '',
    root,
    messages: [],
    opts,
    processor: { plugins },
    get content() {
      return this.css;
    },
    warnings() {
      return this.messages.filter((message) => message.type === 'warning');
    },
    warn(text, options = {}) {
      const warning: Message = {
        type: 'warning',
        text,
        plugin: pluginName(this.lastPlugin),
        ...options,
      };
      this.messages.push(warning);
      return warning;
    },
    toString() {
      return this.css;
    },
  };
  return result;
}

function normalizePlugins(plugins: AcceptedPlugin[]): RuntimePlugin[] {
  const normalized: RuntimePlugin[] = [];
  for (const accepted of plugins) {
    let plugin: unknown = accepted;
    if (typeof plugin === 'function' && (plugin as { postcss?: unknown }).postcss === true) {
      plugin = (plugin as () => unknown)();
    } else if (
      plugin &&
      (typeof plugin === 'function' || typeof plugin === 'object') &&
      (plugin as { postcss?: unknown }).postcss &&
      (plugin as { postcss?: unknown }).postcss !== true
    ) {
      plugin = (plugin as { postcss: unknown }).postcss;
    }

    if (plugin && typeof plugin === 'object' && Array.isArray((plugin as RuntimePlugin).plugins)) {
      normalized.push(...normalizePlugins((plugin as RuntimePlugin).plugins ?? []));
    } else if (plugin && typeof plugin === 'object' && (plugin as RuntimePlugin).postcssPlugin) {
      normalized.push(plugin as RuntimePlugin);
    } else if (typeof plugin === 'function') {
      const transformer = plugin as (root: Node, result: PluginResult) => unknown;
      normalized.push({
        postcssPlugin: plugin.name || 'anonymous',
        Once: (root, helpers) => transformer(root, helpers.result),
      });
    } else {
      throw new Error(`${String(plugin)} is not a PostCSS plugin`);
    }
  }
  return normalized;
}

const CHILDREN = Symbol('children');

const PLUGIN_PROPS = new Set([
  'AtRule',
  'AtRuleExit',
  'Comment',
  'CommentExit',
  'Declaration',
  'DeclarationExit',
  'Document',
  'DocumentExit',
  'Once',
  'OnceExit',
  'postcssPlugin',
  'prepare',
  'Root',
  'RootExit',
  'Rule',
  'RuleExit',
]);

const NOT_VISITORS = new Set([
  'Once',
  'OnceExit',
  'postcssPlugin',
  'prepare',
  'plugins',
  'postcss',
]);

type ListenerEntry = [RuntimePlugin, Listener];
type Listeners = Record<string, ListenerEntry[]>;

function prepareVisitors(plugins: RuntimePlugin[]): Listeners {
  const listeners: Listeners = {};
  const add = (plugin: RuntimePlugin, type: string, callback: Listener): void => {
    (listeners[type] ??= []).push([plugin, callback]);
  };

  for (const plugin of plugins) {
    for (const event of Object.keys(plugin)) {
      if (NOT_VISITORS.has(event)) continue;
      if (!PLUGIN_PROPS.has(event) && /^[A-Z]/.test(event)) {
        throw new Error(
          `Unknown event ${event} in ${plugin.postcssPlugin ?? 'anonymous'}. ` +
            'Try to update PostCSS or postcss-go.',
        );
      }
      if (!PLUGIN_PROPS.has(event)) continue;

      const value = plugin[event];
      if (typeof value === 'object' && value) {
        for (const [filter, callback] of Object.entries(value as Record<string, Listener>)) {
          if (typeof callback !== 'function') continue;
          if (filter === '*') add(plugin, event, callback);
          else add(plugin, `${event}-${filter.toLowerCase()}`, callback);
        }
      } else if (typeof value === 'function') {
        add(plugin, event, value as Listener);
      }
    }
  }
  return listeners;
}

function nodeEvent(
  node: Node,
): 'Document' | 'Root' | 'Rule' | 'AtRule' | 'Declaration' | 'Comment' {
  if (node instanceof Document) return 'Document';
  if (node instanceof Root) return 'Root';
  if (node instanceof Rule) return 'Rule';
  if (node instanceof AtRule) return 'AtRule';
  if (node instanceof Declaration) return 'Declaration';
  return 'Comment';
}

function getEvents(node: Node): Array<string | typeof CHILDREN> {
  const type = nodeEvent(node);
  let key: string | false = false;
  if (node instanceof Declaration) key = node.prop.toLowerCase();
  else if (node instanceof AtRule) key = node.name.toLowerCase();

  if (key && node instanceof Container) {
    return [type, `${type}-${key}`, CHILDREN, `${type}Exit`, `${type}Exit-${key}`];
  }
  if (key) {
    return [type, `${type}-${key}`, `${type}Exit`, `${type}Exit-${key}`];
  }
  if (node instanceof Container) {
    return [type, CHILDREN, `${type}Exit`];
  }
  return [type, `${type}Exit`];
}

async function visitNode(node: Node, listeners: Listeners, helpers: PluginHelpers): Promise<void> {
  if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;

  for (const event of getEvents(node)) {
    if (event === CHILDREN) {
      if (node instanceof Container && node.nodes?.length) {
        node.markClean();
        let index = 0;
        while (index < node.nodes.length) {
          const child = node.nodes[index];
          if (!child.isClean) {
            child.markClean();
            await visitNode(child, listeners, helpers);
          }
          const currentIndex = node.nodes.indexOf(child);
          index = currentIndex === -1 ? index : currentIndex + 1;
        }
      }
      continue;
    }

    const visitors = listeners[event];
    if (!visitors) continue;
    for (const [plugin, visitor] of visitors) {
      await runListener(plugin, visitor, node, helpers);
      if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
    }
  }
}

async function runListener(
  plugin: RuntimePlugin,
  listener: Listener | undefined,
  node: Node,
  helpers: PluginHelpers,
): Promise<void> {
  if (!listener) return;
  helpers.result.lastPlugin = plugin;
  try {
    await listener(node.toProxy(), helpers);
  } catch (error) {
    if (error && typeof error === 'object') {
      node.addToError(error as Error);
      if ((error as { plugin?: unknown }).plugin === undefined) {
        Object.defineProperty(error, 'plugin', {
          configurable: true,
          enumerable: true,
          value: pluginName(plugin),
        });
      }
    }
    throw error;
  }
}

function pluginName(plugin: RuntimePlugin | undefined): string | undefined {
  return plugin?.postcssPlugin;
}

function hasPreviousMap(css: string, options: ProcessFileOptions): boolean {
  const map = options.map;
  if (map && typeof map === 'object' && map.prev !== undefined) {
    return map.prev !== false;
  }
  return /\/\*\s*# sourceMappingURL=/.test(css);
}

function attachPreviousMapMetadata(root: Root, css: string, options: ProcessFileOptions): void {
  if (!root.source || !hasPreviousMap(css, options)) return;
  const annotations = [...css.matchAll(/\/\*\s*# sourceMappingURL=(.*?)\*\//gs)];
  const url = annotations.at(-1)?.[1]?.trim();
  const mapOptions = options.map && typeof options.map === 'object' ? options.map : undefined;
  const previous = mapOptions?.prev;
  (
    root.source as unknown as {
      input: { css: string; from?: string; map: { inline: boolean; text?: string } };
    }
  ).input = {
    css,
    from: options.from,
    map: {
      inline: url?.startsWith('data:') === true,
      ...(typeof previous === 'string' ? { text: previous } : {}),
    },
  };
}
