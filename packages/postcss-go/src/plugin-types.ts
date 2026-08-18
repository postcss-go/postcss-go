import type { AtRule, Comment, Declaration, Document, Node, Root, Rule } from './ast.js';
import type { PluginResult, PluginHelpers } from './plugin-runtime.js';

export type PluginListener<T extends Node = Node> = (
  node: T,
  helpers: PluginHelpers,
) => void | Promise<void>;
export type PluginListenerGroup<T extends Node = Node> =
  | PluginListener<T>
  | Record<string, PluginListener<T> | undefined>;

export interface Plugin {
  postcssPlugin: string;
  plugins?: AcceptedPlugin[];
  prepare?: (
    result: PluginResult,
  ) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  Once?: PluginListener<Root>;
  OnceExit?: PluginListener<Root>;
  Document?: PluginListener<Document>;
  DocumentExit?: PluginListener<Document>;
  Root?: PluginListener<Root>;
  RootExit?: PluginListener<Root>;
  Rule?: PluginListener<Rule>;
  RuleExit?: PluginListener<Rule>;
  AtRule?: PluginListenerGroup<AtRule>;
  AtRuleExit?: PluginListenerGroup<AtRule>;
  Declaration?: PluginListenerGroup<Declaration>;
  DeclarationExit?: PluginListenerGroup<Declaration>;
  Comment?: PluginListener<Comment>;
  CommentExit?: PluginListener<Comment>;
  [key: string]: unknown;
}

export type Transformer = ((
  root: Root | Document,
  result: PluginResult,
) => void | Promise<void>) & { postcssPlugin?: string };
export type PluginCreator = (() => Plugin | Promise<Plugin>) & { postcss?: true };
export type AcceptedPlugin =
  | Plugin
  | Transformer
  | PluginCreator
  | { postcss: Plugin | Transformer | PluginCreator }
  | { plugins: AcceptedPlugin[] };
