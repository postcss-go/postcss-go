import { materializePreviousMap, type ProcessFileOptions } from '@postcss-go/shared/map-options';

import {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  asProcessRoot,
  fromJSON,
  fromJSONLocal,
  Node,
  parseCssSync,
  Root,
  Rule,
  runWithWasmSyncCssHelpersBlocked,
  stringifyCssSync,
  type Parser,
  type ProcessRoot,
} from './ast.js';
import {
  AsyncPluginError,
  CssSyntaxError,
  UnknownPluginEventError,
  isThenable,
  observeThenable,
} from './errors.js';
import { attachInputMetadata, annotateOwnedInput, hasPreviousMap, Input } from './input.js';
import { isGoOwned, releaseRetained, retainOwned } from './retained-session.js';
import { list } from './list.js';
import { throwInvalidPlugin } from './plugin-normalize.js';
import type { PostcssGoService } from './service.js';
import type { AstNode as AstDTO, ProcessOptions } from './types.js';
import type { AcceptedPlugin, Plugin, Transformer } from './plugin-types.js';
import { fillDependencyParents, hydrateResultMap, Result } from './result.js';
import { Warning } from './warning.js';
import type { Processor } from './processor.js';
import { prepareStringifyOptions, finalizeMappedCSS } from './source-map-output.js';
import { HANDLE_STATUS_PARSE } from './generated/handle-protocol.js';
import { SessionOwner } from './handle-facade.js';
import { planHandleExecution } from './handle-plan.js';
import { HandleDeclarationUnsupportedError, type HandleBridge } from './handle-session.js';

type PluginBridgeService = Pick<PostcssGoService, 'parse' | 'stringifyResult'> & {
  capabilities?: PostcssGoService['capabilities'];
  parseLive?(css: string, options?: ProcessOptions): Promise<{ root: ProcessRoot }>;
  stringifyResultLive?(
    ast: AstDTO | ProcessRoot,
    options?: ProcessOptions,
  ): Promise<{ css: string; map?: string; mapFile?: string }>;
  parseSync?(css: string, options?: ProcessOptions): { root: AstDTO | ProcessRoot };
  stringifyResultSync?(
    ast: AstDTO | ProcessRoot,
    options?: ProcessOptions,
  ): { css: string; map?: string; mapFile?: string };
  handleBridge?: HandleBridge | null;
};

type LiveAsyncPluginBridgeService = PluginBridgeService &
  Required<Pick<PluginBridgeService, 'parseLive' | 'stringifyResultLive'>>;

type Listener = (node: Node, helpers: PluginHelpers) => unknown;
type ListenerGroup = Listener | Record<string, Listener | undefined>;
export type RuntimePlugin = {
  postcssPlugin?: string;
  plugins?: AcceptedPlugin[];
  postcss?: unknown;
  prepare?: (
    result: PluginResult,
  ) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
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

export type PluginResult = Result<RuntimePlugin | Transformer>;
export type ActivePlugin = RuntimePlugin | Transformer;

export interface PostcssPublic {
  (...plugins: [AcceptedPlugin[]] | AcceptedPlugin[]): Processor;
  default: PostcssPublic;
  plugin<T extends unknown[]>(
    name: string,
    initializer: (...args: T) => Omit<Plugin, 'postcssPlugin'> | Plugin,
  ): ((...args: T) => Plugin) & { postcss: true };
  parse: Parser;
  stringify: (
    node: Node,
    builder?: (chunk: string, node?: Node, type?: string) => void,
  ) => string | undefined;
  fromJSON: typeof fromJSON;
  list: typeof list;
  node: typeof Node;
  Node: typeof Node;
  Container: typeof Container;
  Root: typeof Root;
  Document: typeof Document;
  Rule: typeof Rule;
  AtRule: typeof AtRule;
  Declaration: typeof Declaration;
  Comment: typeof Comment;
  Input: typeof Input;
  Result: typeof Result;
  Warning: typeof Warning;
  CssSyntaxError: typeof CssSyntaxError;
  Processor: typeof Processor;
  root: (defaults?: ConstructorParameters<typeof Root>[0]) => Root;
  document: (defaults?: ConstructorParameters<typeof Document>[0]) => Document;
  rule: (defaults?: ConstructorParameters<typeof Rule>[0]) => Rule;
  atRule: (defaults?: ConstructorParameters<typeof AtRule>[0]) => AtRule;
  decl: (defaults?: ConstructorParameters<typeof Declaration>[0]) => Declaration;
  comment: (defaults?: ConstructorParameters<typeof Comment>[0]) => Comment;
}

export type PluginHelpers = PostcssPublic & {
  result: PluginResult;
  postcss: PostcssPublic;
};

export interface ProcessorFacade {
  process(
    css: string | { toString(): string },
    options?: ProcessFileOptions,
  ): Promise<PluginResult>;
}

export interface ResultProcessorFacade {
  plugins: AcceptedPlugin[];
  version?: string;
}

let processorFactory: ((plugins: AcceptedPlugin[]) => ProcessorFacade) | undefined;

export function setProcessorFactory(factory: (plugins: AcceptedPlugin[]) => ProcessorFacade): void {
  processorFactory = factory;
}

export const postcssApi = Object.assign(
  (...inputs: [AcceptedPlugin[]] | AcceptedPlugin[]) => {
    if (!processorFactory) {
      throw new Error('The postcss-go public entry point has not been initialized');
    }
    const plugins =
      inputs.length === 1 && Array.isArray(inputs[0])
        ? (inputs[0] as AcceptedPlugin[])
        : (inputs as AcceptedPlugin[]);
    return processorFactory(plugins);
  },
  {
    AtRule,
    Comment,
    Container,
    Declaration,
    Document,
    CssSyntaxError,
    Input,
    Node,
    Result,
    Root,
    Rule,
    Warning,
    list,
    fromJSON,
    parse(css: string, opts?: ProcessOptions) {
      return parseCssSync(css, opts);
    },
    stringify(node: Node, builder?: (chunk: string, node?: Node, type?: string) => void) {
      if (!builder) return node.toString();
      stringifyCssSync(node, builder);
    },
    atRule: (defaults: ConstructorParameters<typeof AtRule>[0] = {}) => new AtRule(defaults),
    comment: (defaults: ConstructorParameters<typeof Comment>[0] = {}) => new Comment(defaults),
    decl: (defaults: ConstructorParameters<typeof Declaration>[0] = {}) =>
      new Declaration(defaults),
    document: (defaults: ConstructorParameters<typeof Document>[0] = {}) => new Document(defaults),
    root: (defaults: ConstructorParameters<typeof Root>[0] = {}) => new Root(defaults),
    rule: (defaults: ConstructorParameters<typeof Rule>[0] = {}) => new Rule(defaults),
  },
) as PostcssPublic;

/**
 * Runs JavaScript plugin callbacks around the Go AST bridge. Go owns parsing
 * on the way in; this runtime owns plugin lifecycle, AST-based source maps for
 * the plugin phase, and leaves final map annotation/composition to the engine.
 * WASM plugin runs disable synchronous CSS parse/stringify helpers.
 */
export async function runPluginsWithBridge(
  service: PluginBridgeService,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
  processor?: ResultProcessorFacade,
): Promise<PluginResult> {
  if (service.capabilities?.backend === 'wasm-worker') {
    return runWithWasmSyncCssHelpersBlocked(() =>
      runPluginsWithBridgeBody(service, plugins, css, options, processor),
    );
  }
  return runPluginsWithBridgeBody(service, plugins, css, options, processor);
}

async function runPluginsWithBridgeBody(
  service: PluginBridgeService,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
  processor?: ResultProcessorFacade,
): Promise<PluginResult> {
  options = materializePreviousMap(options);
  const normalized = await normalizePlugins(plugins);
  const liveService = hasLiveAsyncPluginBridge(service) ? service : undefined;
  // Any transport with a handle bridge keeps its AST in-process, so the
  // planner alone decides; the browser no longer needs a backend exception.
  const handled = await tryHandleResultAsync(service, normalized, css, options, processor);
  if (handled) return handled;
  const parsed = liveService
    ? await liveService.parseLive(css, { from: options.from })
    : await service.parse(css, { from: options.from });
  const hydrated = liveProcessRoot(parsed.root);
  if (isGoOwned(hydrated)) annotateOwnedInput(hydrated, css, options as ProcessOptions);
  else attachInputMetadata(hydrated, css, options as ProcessOptions);

  const result = createResult(hydrated, options, normalized, processor);
  result.backend = service.capabilities?.backend;
  const activePlugins: ActivePlugin[] = [];
  for (const plugin of normalized) {
    if (typeof plugin === 'function') {
      activePlugins.push(plugin);
      continue;
    }
    const prepared = await preparePlugin(plugin, result);
    activePlugins.push(prepared ? { ...plugin, ...prepared } : plugin);
  }
  const helpers = {
    ...postcssApi,
    result,
    postcss: postcssApi,
  } as PluginHelpers;
  const listeners = prepareVisitors(activePlugins);

  for (const plugin of activePlugins) {
    await runOnRoot(plugin, helpers, result);
  }

  let current = asProcessRoot(result.root);
  while (!current.isClean) {
    current.markClean();
    await visitNode(current, listeners, helpers);
    current = asProcessRoot(result.root);
  }

  for (const plugin of activePlugins) {
    if (typeof plugin === 'function') continue;
    await runRootListeners(plugin, plugin.OnceExit, asProcessRoot(result.root), helpers);
  }

  fillDependencyParents(result);
  const outputRoot = asProcessRoot(result.root);
  const stringifyOptions = prepareStringifyOptions(
    outputRoot,
    (await resolveAnnotation(options, outputRoot)) as ProcessOptions,
  );
  const stringified = liveService
    ? await liveService.stringifyResultLive(outputRoot, stringifyOptions as ProcessOptions)
    : await service.stringifyResult(outputRoot, stringifyOptions as ProcessOptions);
  result.css = stringified.css;
  result.map = hydrateResultMap(stringified.map);
  result.mapFile = stringified.mapFile;
  return result;
}

function hasLiveAsyncPluginBridge(
  service: PluginBridgeService,
): service is LiveAsyncPluginBridgeService {
  return (
    service.capabilities?.backend === 'native' &&
    typeof service.parseLive === 'function' &&
    typeof service.stringifyResultLive === 'function'
  );
}

/**
 * Handle execution picks its stringify entry point at runtime, so each variant
 * stays optional: the sync bridge has no async counterpart and vice versa.
 */
type HandleExecutionService = Pick<
  PluginBridgeService,
  'capabilities' | 'handleBridge' | 'parseSync'
> &
  Partial<
    Pick<PluginBridgeService, 'stringifyResult' | 'stringifyResultSync' | 'stringifyResultLive'>
  >;

/** Handle execution; callbacks stay on the Go-owned live tree. */
function tryHandleResult(
  service: HandleExecutionService,
  plugins: ActivePlugin[],
  css: string,
  options: ProcessFileOptions,
  processor?: ResultProcessorFacade,
): PluginResult | undefined {
  const opened = openHandleSession(service, plugins, css, options);
  if (!opened) return undefined;
  const { owner, plan } = opened;
  try {
    return executeHandleSync(owner, plan, plugins, css, options, processor, service);
  } catch (error) {
    releaseRetained(owner.root);
    throw error;
  }
}

async function tryHandleResultAsync(
  service: HandleExecutionService,
  plugins: ActivePlugin[],
  css: string,
  options: ProcessFileOptions,
  processor?: ResultProcessorFacade,
): Promise<PluginResult | undefined> {
  const opened = openHandleSession(service, plugins, css, options);
  if (!opened) return undefined;
  const { owner, plan } = opened;
  try {
    return await executeHandleAsync(owner, plan, plugins, css, options, processor, service);
  } catch (error) {
    releaseRetained(owner.root);
    throw error;
  }
}

function openHandleSession(
  service: Pick<PluginBridgeService, 'capabilities' | 'handleBridge' | 'parseSync'>,
  plugins: ActivePlugin[],
  css: string,
  options: ProcessFileOptions,
): { owner: SessionOwner; plan: ReturnType<typeof planHandleExecution> } | undefined {
  const previousMaps = hasPreviousMap(css, options as ProcessOptions);
  const plan = planHandleExecution(
    service.handleBridge,
    Boolean(options.map) || previousMaps,
    plugins,
    previousMaps,
  );
  if (plan.runtime === 'unsupported') return undefined;
  const mutableStructure = plan.runtime === 'handle-full';
  const mutableScalars = plan.runtime === 'handle-scalar' || mutableStructure;
  try {
    const owner = new SessionOwner(service.handleBridge!, css, {
      from: options.from,
      document: options.document == null ? undefined : String(options.document),
      map: (options as ProcessOptions).map,
      mutableScalars,
      mutableStructure,
    });
    owner.diagnostics.planReason = plan.reason;
    owner.diagnostics.hydration = false;
    owner.diagnostics.runtime = plan.runtime;
    retainOwned(owner.root, owner);
    return { owner, plan };
  } catch (error) {
    if ((error as { status?: number })?.status === HANDLE_STATUS_PARSE && service.parseSync) {
      service.parseSync(css, { from: options.from });
    }
    throw error;
  }
}

function attachHandleDiagnostics(
  result: PluginResult,
  plan: ReturnType<typeof planHandleExecution>,
  owner: SessionOwner,
): void {
  Object.defineProperty(result, 'nativePlan', {
    enumerable: false,
    configurable: true,
    value: {
      runtime: plan.runtime,
      reason: owner.diagnostics.planReason,
      hydration: owner.diagnostics.hydration,
      visits: owner.diagnostics.visits,
    },
  });
}

/**
 * Only the in-process native transport can stringify a Go-backed root through
 * the service. Every other transport stringifies from the session that already
 * owns the AST, so no tree crosses a thread or process boundary.
 */
function serviceStringify(
  service: HandleExecutionService,
): Partial<
  Pick<PluginBridgeService, 'stringifyResultSync' | 'stringifyResultLive' | 'stringifyResult'>
> {
  return service.capabilities?.backend === 'native' ? service : {};
}

function stringifyHandleResult(
  owner: SessionOwner,
  root: ProcessRoot,
  css: string,
  options: ProcessFileOptions,
  result: PluginResult,
  service: Partial<
    Pick<PluginBridgeService, 'stringifyResultSync' | 'stringifyResultLive' | 'stringifyResult'>
  >,
  allowAsync: boolean,
): void | Promise<void> {
  fillDependencyParents(result);
  const wantsMap = Boolean(options.map) || hasPreviousMap(css, options as ProcessOptions);
  const prepared = prepareStringifyOptions(root, options as ProcessOptions);

  const apply = (stringified: { css: string; map?: string; mapFile?: string }): void => {
    result.css = stringified.css;
    result.map = hydrateResultMap(stringified.map);
    result.mapFile = stringified.mapFile;
  };

  // Prefer the full native stringify path so annotations, previous-map composition,
  // and inline maps match the binary backend.
  if (!allowAsync && typeof service.stringifyResultSync === 'function') {
    apply(service.stringifyResultSync(root, prepared as ProcessOptions));
    return;
  }
  if (allowAsync && typeof service.stringifyResultLive === 'function') {
    return service.stringifyResultLive(root, prepared as ProcessOptions).then(apply);
  }
  if (allowAsync && typeof service.stringifyResult === 'function') {
    return service.stringifyResult(root, prepared as ProcessOptions).then(apply);
  }
  if (typeof service.stringifyResultSync === 'function') {
    apply(service.stringifyResultSync(root, prepared as ProcessOptions));
    return;
  }

  if (wantsMap) {
    const mapOpts =
      prepared.map && typeof prepared.map === 'object' ? prepared.map : { inline: false };
    const mapped = owner.session.stringifyMap(owner.session.rootHandle, {
      from: options.from,
      to: options.to,
      absolute: Boolean(mapOpts.absolute),
      preserveAnnotation: mapOpts.annotation !== false,
    });
    const finalized = finalizeMappedCSS(mapped.css, mapped.map, prepared as ProcessOptions);
    result.css = finalized.css;
    result.map = hydrateResultMap(finalized.map);
    result.mapFile = finalized.mapFile;
  } else {
    result.css = owner.session.stringify();
  }
}

function executeHandleSync(
  owner: SessionOwner,
  plan: ReturnType<typeof planHandleExecution>,
  plugins: ActivePlugin[],
  css: string,
  options: ProcessFileOptions,
  processor: ResultProcessorFacade | undefined,
  service: HandleExecutionService,
): PluginResult {
  const root = owner.root;
  const result = createResult(root, options, plugins, processor);
  Object.defineProperty(result, 'root', {
    enumerable: true,
    configurable: false,
    get: () => root,
    set: () => {
      throw new HandleDeclarationUnsupportedError('result.root');
    },
  });
  result.backend = service.capabilities?.backend;
  const active = plugins.map((plugin) => {
    if (typeof plugin === 'function') return plugin;
    const prepared = preparePluginSync(plugin, result);
    return prepared ? { ...plugin, ...prepared } : plugin;
  });
  const helpers = { ...postcssApi, result, postcss: postcssApi } as PluginHelpers;
  const listeners = prepareVisitors(active);
  const runWithFlush = (
    plugin: RuntimePlugin,
    listener: Listener | undefined,
    node: Node,
    extensionPoint: string,
    proxy = true,
  ): void => {
    if (!listener) return;
    helpers.result.lastPlugin = plugin;
    owner.diagnostics.visits += 1;
    try {
      const returned = listener(proxy ? node.toProxy() : node, helpers);
      assertSynchronous(returned, extensionPoint, plugin);
      owner.flushPatches();
    } catch (error) {
      try {
        owner.flushPatches();
      } catch {
        // Prefer the original callback error.
      }
      if (error && typeof error === 'object') {
        node.addToError(error as Error);
        attachPluginToError(error, plugin, helpers.result.processor);
      }
      throw error;
    }
  };
  for (const plugin of active) {
    result.lastPlugin = plugin;
    try {
      if (typeof plugin === 'function') {
        const returned = plugin(asProcessRoot(result.root), result);
        assertSynchronous(returned, 'plugin', plugin);
        owner.flushPatches();
        continue;
      }
      if (root instanceof Document) {
        for (const child of root.nodes ?? [])
          runWithFlush(plugin, plugin.Once, child, 'Once', false);
      } else {
        runWithFlush(plugin, plugin.Once, root, 'Once', false);
      }
    } catch (error) {
      attachPluginToError(error, plugin, result.processor);
      throw error;
    }
  }
  const visit = (node: Node): void => {
    if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
    owner.markClean(node);
    for (const event of getEvents(node)) {
      if (event === CHILDREN) {
        if (node instanceof Container && node.nodes?.length) {
          node.markClean();
          let index = 0;
          while (index < node.nodes.length) {
            const child = node.nodes[index];
            if (!child.isClean) {
              child.markClean();
              visit(child);
            }
            const currentIndex = node.nodes.indexOf(child);
            index = currentIndex === -1 ? index : currentIndex + 1;
          }
        }
        continue;
      }
      for (const [plugin, listener] of listeners[event] ?? []) {
        runWithFlush(plugin, listener, node, event);
        if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
      }
    }
  };
  let current = root;
  while (!current.isClean) {
    visit(current);
    current = owner.root;
  }
  for (const plugin of active) {
    if (typeof plugin === 'function') continue;
    if (root instanceof Document) {
      for (const child of root.nodes ?? [])
        runWithFlush(plugin, plugin.OnceExit, child, 'OnceExit', false);
    } else {
      runWithFlush(plugin, plugin.OnceExit, root, 'OnceExit', false);
    }
  }
  stringifyHandleResult(owner, root, css, options, result, serviceStringify(service), false);
  attachHandleDiagnostics(result, plan, owner);
  return result;
}

async function executeHandleAsync(
  owner: SessionOwner,
  plan: ReturnType<typeof planHandleExecution>,
  plugins: ActivePlugin[],
  css: string,
  options: ProcessFileOptions,
  processor: ResultProcessorFacade | undefined,
  service: HandleExecutionService,
): Promise<PluginResult> {
  const root = owner.root;
  const result = createResult(root, options, plugins, processor);
  Object.defineProperty(result, 'root', {
    enumerable: true,
    configurable: false,
    get: () => root,
    set: () => {
      throw new HandleDeclarationUnsupportedError('result.root');
    },
  });
  result.backend = service.capabilities?.backend;
  const active: ActivePlugin[] = [];
  for (const plugin of plugins) {
    if (typeof plugin === 'function') {
      active.push(plugin);
      continue;
    }
    const prepared = await preparePlugin(plugin, result);
    active.push(prepared ? { ...plugin, ...prepared } : plugin);
  }
  const helpers = { ...postcssApi, result, postcss: postcssApi } as PluginHelpers;
  const listeners = prepareVisitors(active);
  const runWithFlush = async (
    plugin: RuntimePlugin,
    listener: Listener | undefined,
    node: Node,
    _extensionPoint: string,
    proxy = true,
  ): Promise<void> => {
    if (!listener) return;
    helpers.result.lastPlugin = plugin;
    owner.diagnostics.visits += 1;
    try {
      const returned = listener(proxy ? node.toProxy() : node, helpers);
      if (isThenable(returned)) await returned;
      owner.flushPatches();
    } catch (error) {
      try {
        owner.flushPatches();
      } catch {
        // Prefer the original callback error.
      }
      if (error && typeof error === 'object') {
        node.addToError(error as Error);
        attachPluginToError(error, plugin, helpers.result.processor);
      }
      throw error;
    }
  };
  for (const plugin of active) {
    result.lastPlugin = plugin;
    try {
      if (typeof plugin === 'function') {
        const returned = plugin(asProcessRoot(result.root), result);
        if (isThenable(returned)) await returned;
        owner.flushPatches();
        continue;
      }
      if (root instanceof Document) {
        for (const child of root.nodes ?? [])
          await runWithFlush(plugin, plugin.Once, child, 'Once', false);
      } else {
        await runWithFlush(plugin, plugin.Once, root, 'Once', false);
      }
    } catch (error) {
      attachPluginToError(error, plugin, result.processor);
      throw error;
    }
  }
  const visit = async (node: Node): Promise<void> => {
    if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
    owner.markClean(node);
    for (const event of getEvents(node)) {
      if (event === CHILDREN) {
        if (node instanceof Container && node.nodes?.length) {
          node.markClean();
          let index = 0;
          while (index < node.nodes.length) {
            const child = node.nodes[index];
            if (!child.isClean) {
              child.markClean();
              await visit(child);
            }
            const currentIndex = node.nodes.indexOf(child);
            index = currentIndex === -1 ? index : currentIndex + 1;
          }
        }
        continue;
      }
      for (const [plugin, listener] of listeners[event] ?? []) {
        await runWithFlush(plugin, listener, node, event);
        if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
      }
    }
  };
  let current = root;
  while (!current.isClean) {
    await visit(current);
    current = owner.root;
  }
  for (const plugin of active) {
    if (typeof plugin === 'function') continue;
    if (root instanceof Document) {
      for (const child of root.nodes ?? [])
        await runWithFlush(plugin, plugin.OnceExit, child, 'OnceExit', false);
    } else {
      await runWithFlush(plugin, plugin.OnceExit, root, 'OnceExit', false);
    }
  }
  await stringifyHandleResult(owner, root, css, options, result, serviceStringify(service), true);
  attachHandleDiagnostics(result, plan, owner);
  return result;
}

/**
 * Fully synchronous counterpart to `runPluginsWithBridge`. Every extension
 * point is checked for thenables so synchronous processing never enters a
 * Promise or silently switches execution modes.
 */
export function runPluginsWithBridgeSync(
  service: Required<Pick<PluginBridgeService, 'parseSync' | 'stringifyResultSync'>> &
    Pick<PluginBridgeService, 'capabilities' | 'handleBridge'>,
  plugins: AcceptedPlugin[],
  css: string,
  options: ProcessFileOptions,
  processor?: ResultProcessorFacade,
): PluginResult {
  options = materializePreviousMap(options);
  const normalized = normalizePluginsSync(plugins);
  const handled = tryHandleResult(service, normalized, css, options, processor);
  if (handled) return handled;
  const parsed = service.parseSync(css, { from: options.from });
  const hydrated = liveProcessRoot(parsed.root);
  if (isGoOwned(hydrated)) annotateOwnedInput(hydrated, css, options as ProcessOptions);
  else attachInputMetadata(hydrated, css, options as ProcessOptions);

  const result = createResult(hydrated, options, normalized, processor);
  result.backend = service.capabilities?.backend;
  const activePlugins: ActivePlugin[] = normalized.map((plugin) => {
    if (typeof plugin === 'function') return plugin;
    const prepared = preparePluginSync(plugin, result);
    return prepared ? { ...plugin, ...prepared } : plugin;
  });
  const helpers = {
    ...postcssApi,
    result,
    postcss: postcssApi,
  } as PluginHelpers;
  const listeners = prepareVisitors(activePlugins);

  for (const plugin of activePlugins) {
    runOnRootSync(plugin, helpers, result);
  }
  let current = asProcessRoot(result.root);
  while (!current.isClean) {
    current.markClean();
    visitNodeSync(current, listeners, helpers);
    current = asProcessRoot(result.root);
  }
  for (const plugin of activePlugins) {
    if (typeof plugin === 'function') continue;
    runRootListenersSync(plugin, plugin.OnceExit, asProcessRoot(result.root), helpers, 'OnceExit');
  }

  fillDependencyParents(result);
  const outputRoot = asProcessRoot(result.root);
  const stringifyOptions = prepareStringifyOptions(
    outputRoot,
    resolveAnnotationSync(options, outputRoot) as ProcessOptions,
  );
  const stringified = service.stringifyResultSync(outputRoot, stringifyOptions as ProcessOptions);
  result.css = stringified.css;
  result.map = hydrateResultMap(stringified.map);
  result.mapFile = stringified.mapFile;
  return result;
}

function liveProcessRoot(root: unknown): ProcessRoot {
  if (root instanceof Node) return asProcessRoot(root);
  if (root && typeof root === 'object') {
    // Worker string-in/out still returns a JSON tree. Keep it on the public
    // identity skeleton so the JavaScript visitor loop can run; intern happens
    // at stringify if a Go arena is available.
    return asProcessRoot(fromJSONLocal(root as object) as Node);
  }
  throw new Error('postcss-go parse must return a live tree; AST DTO transport is removed');
}

function createResult(
  root: ProcessRoot | (() => ProcessRoot),
  opts: ProcessFileOptions,
  plugins: ActivePlugin[],
  processor?: ResultProcessorFacade,
): PluginResult {
  return new Result<RuntimePlugin | Transformer>(processor ?? { plugins }, root, opts);
}

async function preparePlugin(
  plugin: RuntimePlugin,
  result: PluginResult,
): Promise<Record<string, unknown> | void> {
  if (!plugin.prepare) return;
  result.lastPlugin = plugin;
  try {
    return await plugin.prepare(result);
  } catch (error) {
    attachPluginToError(error, plugin, result.processor);
    throw error;
  }
}

function preparePluginSync(
  plugin: RuntimePlugin,
  result: PluginResult,
): Record<string, unknown> | void {
  if (!plugin.prepare) return;
  result.lastPlugin = plugin;
  try {
    const prepared = plugin.prepare(result);
    assertSynchronous(prepared, 'prepare', plugin);
    return prepared as Record<string, unknown> | void;
  } catch (error) {
    attachPluginToError(error, plugin, result.processor);
    throw error;
  }
}

async function normalizePlugins(plugins: AcceptedPlugin[]): Promise<ActivePlugin[]> {
  const normalized: ActivePlugin[] = [];
  for (const accepted of plugins) {
    normalized.push(...(await normalizeOnePlugin(accepted)));
  }
  return normalized;
}

function normalizePluginsSync(plugins: AcceptedPlugin[]): ActivePlugin[] {
  const normalized: ActivePlugin[] = [];
  for (const accepted of plugins) {
    normalized.push(...normalizeOnePluginSync(accepted));
  }
  return normalized;
}

/** Unwrap `{ postcss }` wrappers, then invoke creators before classifying the plugin. */
async function normalizeOnePlugin(accepted: AcceptedPlugin): Promise<ActivePlugin[]> {
  let plugin: unknown = unwrapPostcssProperty(accepted);

  if (typeof plugin === 'function' && (plugin as { postcss?: unknown }).postcss === true) {
    plugin = await (plugin as () => unknown)();
    plugin = unwrapPostcssProperty(plugin);
  }

  if (plugin && typeof plugin === 'object' && Array.isArray((plugin as RuntimePlugin).plugins)) {
    return normalizePlugins((plugin as RuntimePlugin).plugins ?? []);
  }
  if (plugin && typeof plugin === 'object' && (plugin as RuntimePlugin).postcssPlugin) {
    return [plugin as RuntimePlugin];
  }
  if (typeof plugin === 'function') {
    return [plugin as Transformer];
  }
  throwInvalidPlugin(plugin);
}

function normalizeOnePluginSync(accepted: AcceptedPlugin): ActivePlugin[] {
  let plugin: unknown = unwrapPostcssProperty(accepted);

  if (typeof plugin === 'function' && (plugin as { postcss?: unknown }).postcss === true) {
    plugin = (plugin as () => unknown)();
    assertSynchronous(plugin, 'plugin creator');
    plugin = unwrapPostcssProperty(plugin);
  }

  if (plugin && typeof plugin === 'object' && Array.isArray((plugin as RuntimePlugin).plugins)) {
    return normalizePluginsSync((plugin as RuntimePlugin).plugins ?? []);
  }
  if (plugin && typeof plugin === 'object' && (plugin as RuntimePlugin).postcssPlugin) {
    return [plugin as RuntimePlugin];
  }
  if (typeof plugin === 'function') {
    return [plugin as Transformer];
  }
  throwInvalidPlugin(plugin);
}

function unwrapPostcssProperty(value: unknown): unknown {
  let current = value;
  while (
    current &&
    (typeof current === 'function' || typeof current === 'object') &&
    (current as { postcss?: unknown }).postcss &&
    (current as { postcss?: unknown }).postcss !== true
  ) {
    current = (current as { postcss: unknown }).postcss;
  }
  return current;
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

function prepareVisitors(plugins: ActivePlugin[]): Listeners {
  const listeners: Listeners = {};
  const add = (plugin: RuntimePlugin, type: string, callback: Listener): void => {
    (listeners[type] ??= []).push([plugin, callback]);
  };

  for (const plugin of plugins) {
    if (typeof plugin === 'function') continue;
    for (const event of Object.keys(plugin)) {
      if (NOT_VISITORS.has(event)) continue;
      if (!PLUGIN_PROPS.has(event) && /^[A-Z]/.test(event)) {
        throw new UnknownPluginEventError(event, plugin.postcssPlugin);
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

function visitNodeSync(node: Node, listeners: Listeners, helpers: PluginHelpers): void {
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
            visitNodeSync(child, listeners, helpers);
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
      runListenerSync(plugin, visitor, node, helpers, String(event));
      if (node.type !== 'root' && node.type !== 'document' && !node.parent) return;
    }
  }
}

async function runOnRoot(
  plugin: ActivePlugin,
  helpers: PluginHelpers,
  result: PluginResult,
): Promise<void> {
  result.lastPlugin = plugin;
  try {
    if (typeof plugin === 'function') {
      await plugin(asProcessRoot(result.root), result);
      return;
    }
    await runRootListeners(plugin, plugin.Once, asProcessRoot(result.root), helpers);
  } catch (error) {
    attachPluginToError(error, plugin, result.processor);
    throw error;
  }
}

function runOnRootSync(plugin: ActivePlugin, helpers: PluginHelpers, result: PluginResult): void {
  result.lastPlugin = plugin;
  try {
    if (typeof plugin === 'function') {
      const returned = plugin(asProcessRoot(result.root), result);
      assertSynchronous(returned, 'plugin', plugin);
      return;
    }
    runRootListenersSync(plugin, plugin.Once, asProcessRoot(result.root), helpers, 'Once');
  } catch (error) {
    attachPluginToError(error, plugin, result.processor);
    throw error;
  }
}

async function runListener(
  plugin: RuntimePlugin,
  listener: Listener | undefined,
  node: Node,
  helpers: PluginHelpers,
  proxy = true,
): Promise<void> {
  if (!listener) return;
  helpers.result.lastPlugin = plugin;
  try {
    await listener(proxy ? node.toProxy() : node, helpers);
  } catch (error) {
    if (error && typeof error === 'object') {
      node.addToError(error as Error);
      attachPluginToError(error, plugin, helpers.result.processor);
    }
    throw error;
  }
}

function runListenerSync(
  plugin: RuntimePlugin,
  listener: Listener | undefined,
  node: Node,
  helpers: PluginHelpers,
  extensionPoint: string,
  proxy = true,
): void {
  if (!listener) return;
  helpers.result.lastPlugin = plugin;
  try {
    const returned = listener(proxy ? node.toProxy() : node, helpers);
    assertSynchronous(returned, extensionPoint, plugin);
  } catch (error) {
    if (error && typeof error === 'object') {
      node.addToError(error as Error);
      attachPluginToError(error, plugin, helpers.result.processor);
    }
    throw error;
  }
}

async function runRootListeners(
  plugin: RuntimePlugin,
  listener: Listener | undefined,
  root: ProcessRoot,
  helpers: PluginHelpers,
): Promise<void> {
  if (!listener) return;
  if (root instanceof Document) {
    await Promise.all(
      root.nodes.map((child) => runListener(plugin, listener, child, helpers, false)),
    );
  } else {
    await runListener(plugin, listener, root, helpers, false);
  }
}

function runRootListenersSync(
  plugin: RuntimePlugin,
  listener: Listener | undefined,
  root: ProcessRoot,
  helpers: PluginHelpers,
  extensionPoint: string,
): void {
  if (!listener) return;
  if (root instanceof Document) {
    for (const child of root.nodes) {
      runListenerSync(plugin, listener, child, helpers, extensionPoint, false);
    }
  } else {
    runListenerSync(plugin, listener, root, helpers, extensionPoint, false);
  }
}

function attachPluginToError(
  error: unknown,
  plugin: ActivePlugin,
  processor?: { version?: string },
): void {
  if (!error || typeof error !== 'object') return;
  if ((error as { plugin?: unknown }).plugin === undefined) {
    Object.defineProperty(error, 'plugin', {
      configurable: true,
      enumerable: true,
      value: pluginName(plugin),
    });
  }
  if (error instanceof CssSyntaxError) {
    error.setMessage();
    return;
  }
  const pluginVersion = pluginPostcssVersion(plugin);
  if (
    !pluginVersion ||
    !processor?.version ||
    typeof process === 'undefined' ||
    process.env.NODE_ENV === 'production'
  ) {
    return;
  }
  const [pluginMajor = '0', pluginMinor = '0'] = pluginVersion.split('.');
  const [runtimeMajor = '0', runtimeMinor = '0'] = processor.version.split('.');
  if (
    pluginMajor === runtimeMajor &&
    Number.parseInt(pluginMinor, 10) <= Number.parseInt(runtimeMinor, 10)
  ) {
    return;
  }
  console.error(
    `Unknown error from PostCSS plugin. Your current postcss-go version is ${processor.version}, but ${pluginName(plugin) ?? 'plugin'} uses ${pluginVersion}. Perhaps this is the source of the error below.`,
  );
}

function assertSynchronous(value: unknown, extensionPoint: string, plugin?: ActivePlugin): void {
  if (isThenable(value)) {
    observeThenable(value);
    throw new AsyncPluginError(extensionPoint, pluginName(plugin));
  }
}

async function resolveAnnotation(
  options: ProcessFileOptions,
  root: ProcessRoot,
): Promise<ProcessFileOptions> {
  const map = options.map;
  if (!map || typeof map !== 'object' || typeof map.annotation !== 'function') return options;
  const annotation = await map.annotation(options.to, root);
  return { ...options, map: { ...map, annotation } };
}

function resolveAnnotationSync(options: ProcessFileOptions, root: ProcessRoot): ProcessFileOptions {
  const map = options.map;
  if (!map || typeof map !== 'object' || typeof map.annotation !== 'function') return options;
  const annotation = map.annotation(options.to, root);
  assertSynchronous(annotation, 'map.annotation');
  return { ...options, map: { ...map, annotation: annotation as string } };
}

function pluginName(plugin: ActivePlugin | undefined): string | undefined {
  if (!plugin) return undefined;
  if (typeof plugin === 'function') {
    return plugin.postcssPlugin || plugin.name || 'anonymous';
  }
  return plugin.postcssPlugin;
}

function pluginPostcssVersion(plugin: ActivePlugin): string | undefined {
  const version = (plugin as { postcssVersion?: unknown }).postcssVersion;
  return typeof version === 'string' ? version : undefined;
}
