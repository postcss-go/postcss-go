import { readFileSync } from 'node:fs';
import { setPreviousMapFileLoader } from './previous-map.js';

setPreviousMapFileLoader((file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
});

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
  type Parser,
  type ProcessRoot,
  type RootInit,
  type RuleInit,
  type Stringifier,
  type StringifierSyntax,
  type WalkCallback,
} from './ast.js';
export { Input, type InputFilePosition, type InputJSON } from './input.js';
export {
  AsyncBackendUnavailableError,
  AsyncPluginError,
  CssSyntaxError,
  InvalidPluginError,
  SyncBackendUnavailableError,
  UnknownPluginEventError,
  UnsupportedAstNodeError,
  UnsupportedPluginFeatureError,
  UnsupportedSyntaxError,
  type CssSyntaxErrorOptions,
  type RangePosition,
} from './errors.js';
export { WasmWorkerError, errorFromWasmDto, type WasmErrorDTO } from './wasm/errors.js';
export { Warning, type WarningOptions } from './warning.js';
export { Result, ResultMap, type ResultProcessor } from './result.js';
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
  WASM_WORKER_BACKEND_CAPABILITIES,
  UnsupportedServiceError,
  isSyncPostcssGoService,
  type AsyncOnlyBackendCapabilities,
  type BackendCapabilities,
  type BackendKind,
  type PostcssGoService,
  type SyncPostcssGoService,
  type SynchronousBackendCapabilities,
} from './service.js';
export { PreviousMap, setPreviousMapFileLoader, type PreviousMapOptions } from './previous-map.js';
export { list } from './list.js';
export { type PluginHelpers, type PluginResult } from './plugin-runtime.js';
export type {
  AcceptedPlugin,
  Plugin,
  PluginCreator,
  PluginListener,
  PluginListenerGroup,
  Transformer,
} from './plugin-types.js';
export type { MapOptions, ProcessFileOptions } from '@postcss-go/shared/map-options';
export { isNativeBridgeAvailable } from './native.js';
export {
  loadConfig,
  type ConfigContext,
  type ConfigFileContext,
  type ConfiguredPlugins,
  type LoadedConfig,
  type PostcssGoConfig,
  type PostcssGoConfigExport,
} from './config.js';
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
  ResultMessage,
  DependencyMessage,
  DirDependencyMessage,
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
  Syntax,
} from './types.js';

export { postcss as default } from './processor.js';
