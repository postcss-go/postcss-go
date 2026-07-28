export {
  noWork,
  parse,
  parseAst,
  process,
  stringify,
  stringifyAst,
  toResult,
  type DocumentResult,
} from './api.js';
export {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  Node,
  Root,
  Rule,
  fromAst,
  fromJSON,
  toAst,
  asProcessRoot,
  type AnyNode,
  type AtRuleInit,
  type Builder,
  type ChildNode,
  type CommentInit,
  type ContainerInit,
  type DeclarationInit,
  type DocumentInit,
  type InsertMode,
  type NodeChild,
  type NodeFromJSON,
  type NodeInit,
  type NodeInput,
  type NodeType,
  type ProcessRoot,
  type RootInit,
  type RuleInit,
  type Stringifier,
  type Syntax,
  type WalkCallback,
} from './ast.js';
export { Input, hydrateInput, type InputJSON } from './input.js';
export {
  AsyncPluginError,
  CssSyntaxError,
  SyncBackendUnavailableError,
  UnsupportedAstNodeError,
  UnsupportedSyntaxError,
  type CssSyntaxErrorOptions,
} from './errors.js';
export { Warning, type WarningOptions } from './warning.js';
export { Result, ResultMap, type ResultProcessor } from './result.js';
export type { Parser } from './parser.js';
export {
  noWorkSync,
  getBackendCapabilities,
  parseSync,
  postcss,
  processSync,
  Processor,
  stringifySync,
  type CssInput,
  type PostcssGoCapabilities,
  type Postcss,
  type ProcessorOptions,
  type PublicResult,
} from './processor.js';
export {
  NATIVE_BACKEND_CAPABILITIES,
  STDIO_BACKEND_CAPABILITIES,
  WASM_WORKER_BACKEND_CAPABILITIES,
  isSyncPostcssGoService,
  type AsyncOnlyBackendCapabilities,
  type BackendCapabilities,
  type BackendKind,
  type PostcssGoService,
  type SyncPostcssGoService,
  type SynchronousBackendCapabilities,
} from './service.js';
export { PreviousMap, type PreviousMapOptions } from './previous-map.js';
export {
  list,
  postcssApi,
  type PluginHelpers,
  type PluginResult,
  type RuntimePlugin,
} from './plugin-runtime.js';
export type {
  AcceptedPlugin,
  Plugin,
  PluginCreator,
  PluginListener,
  PluginListenerGroup,
  Transformer,
} from './plugin-types.js';
export { parseCliArgs, type CliArgv } from './args.js';
export { runCLI } from './cli.js';
export {
  default as createDependencyGraph,
  type DependencyGraph,
  type DependencyMessage,
  type DirDependencyMessage,
  type GraphMessage,
} from './create-dependency-graph.js';
export {
  assertGoCompatibility,
  createGoEngine,
  getEffectiveMapOption,
  isExternalSourceMap,
  isSourceMapEnabled,
  processWithGoEngine,
  runPluginChain,
  type CliConfig,
  type CliMessage,
  type CliProcessResult,
  type GoEngine,
} from './engine.js';
export {
  applyMapAnnotation,
  applyMapAnnotationAsync,
  mapDefersInlineMode,
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
export {
  getMapfile,
  joinMapAnnotationPath,
  toSourceMapPath,
  type MapOptions,
  type ProcessFileOptions,
} from '@postcss-go/shared/map-path';
export { BrowserPostcssGoService } from './browser.js';
export {
  createNodeService,
  NodePostcssGoService,
  type NodePostcssGoServiceOptions,
} from './node.js';
export { createNativeService, isNativeBridgeAvailable, NativePostcssGoService } from './native.js';
export { decodeAst, encodeAst, hydrateAst, serializeAst } from './codec.js';
export { getPollInterval, usePolling } from './poll.js';
export { getBundledGoBridgeBinPath, resolveGoBridgeServiceOptions } from './resolve-go-bridge.js';
export { UnsupportedServiceError } from './service.js';
export type {
  AstNode,
  AstStringifyResult,
  AtRuleNode,
  CommentNode,
  DeclarationNode,
  DocumentNode,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  SourceMap,
  StringifierBuilder,
  CustomParser,
  CustomParserResult,
  CustomStringifier,
  PreviousSourceMap,
  RootNode,
  RawField,
  RawValue,
  Raws,
  RuleNode,
  SourceInput,
  SourceLocation,
  SourcePosition,
  SourceMapOptions,
} from './types.js';

export { postcss as default } from './processor.js';
