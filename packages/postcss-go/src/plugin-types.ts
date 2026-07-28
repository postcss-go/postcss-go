import type { Node } from './ast.js';
import type { PluginResult, PluginHelpers } from './plugin-runtime.js';

export type PluginListener = (node: Node, helpers: PluginHelpers) => unknown;
export type PluginListenerGroup = PluginListener | Record<string, PluginListener | undefined>;

export interface Plugin {
  postcssPlugin: string;
  plugins?: AcceptedPlugin[];
  prepare?: (
    result: PluginResult,
  ) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  Once?: PluginListener;
  OnceExit?: PluginListener;
  Document?: PluginListenerGroup;
  DocumentExit?: PluginListenerGroup;
  Root?: PluginListenerGroup;
  RootExit?: PluginListenerGroup;
  Rule?: PluginListenerGroup;
  RuleExit?: PluginListenerGroup;
  AtRule?: PluginListenerGroup;
  AtRuleExit?: PluginListenerGroup;
  Declaration?: PluginListenerGroup;
  DeclarationExit?: PluginListenerGroup;
  Comment?: PluginListenerGroup;
  CommentExit?: PluginListenerGroup;
  [key: string]: unknown;
}

export type Transformer = (root: Node, result: PluginResult) => unknown;
export type PluginCreator = (() => Plugin | Promise<Plugin>) & { postcss?: true };
export type AcceptedPlugin =
  | Plugin
  | Transformer
  | PluginCreator
  | { postcss: Plugin | Transformer | PluginCreator }
  | { plugins: AcceptedPlugin[] };
