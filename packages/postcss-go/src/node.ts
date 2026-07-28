import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeProcessOptions,
  type NormalizeProcessOptionsInput,
} from '@postcss-go/shared/map-options';
import { joinMapAnnotationPath } from '@postcss-go/shared/map-path';
import { STDIO_BACKEND_CAPABILITIES, type PostcssGoService } from './service.js';
import { asProcessRoot, fromAst } from './ast.js';
import { assertSupportedAst } from './codec.js';
import { CssSyntaxError } from './errors.js';
import { attachInputMetadata, Input } from './input.js';
import { assertSupportedSyntax } from './syntax-options.js';
import { finalizeStringifyResult, prepareStringifyOptions } from './source-map-output.js';
import type {
  AstNode,
  AstStringifyResult,
  NoWorkResult,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  Warning,
} from './types.js';

type BridgeMethod = 'parse' | 'process' | 'noWork' | 'stringify';

type BridgeParams =
  | { css: string; options?: ProcessOptions }
  | { ast: AstNode; options?: ProcessOptions };

type BridgeCommand = { command: string; args: string[]; cwd: string };

type PendingRequest = {
  resolve: (value: BridgeSuccessResponse) => void;
  reject: (error: Error) => void;
};

type BridgeResult = {
  css?: string;
  map?: string;
  root?: ParseResult['root'];
  messages?: Warning[];
};

type JsonRpcRequest<TParams> = {
  jsonrpc: '2.0';
  id: number;
  method: BridgeMethod;
  params: TParams;
};

type JsonRpcError = {
  code: number;
  message: string;
  name?: string;
  reason?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  file?: string;
  plugin?: string;
};

type JsonRpcResponse<TResult> = {
  jsonrpc: '2.0';
  id: number | null;
  result?: TResult;
  error?: JsonRpcError;
};

type BridgeSuccessResponse = { jsonrpc: '2.0'; id: number; result?: BridgeResult };

export interface NodePostcssGoServiceOptions {
  /** Explicit bridge executable. Defaults to the bundled bridge or `go run`. */
  binPath?: string;
  /** Arguments passed to `binPath`. */
  binArgs?: string[];
  /** Working directory used when starting the bridge. */
  workingDirectory?: string;
}

export function createNodeService(options: NodePostcssGoServiceOptions = {}): NodePostcssGoService {
  return new NodePostcssGoService(options);
}

export class NodePostcssGoService implements PostcssGoService {
  readonly capabilities = STDIO_BACKEND_CAPABILITIES;
  readonly binPath?: string;
  readonly binArgs?: string[];
  readonly workingDirectory?: string;

  private readonly bridge: BridgeTransport;
  private closed = false;

  constructor(options: NodePostcssGoServiceOptions = {}) {
    this.binPath = options.binPath;
    this.binArgs = options.binArgs;
    this.workingDirectory = options.workingDirectory;
    this.bridge = new BridgeTransport(() => resolveBridgeCommand(this));
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    assertSupportedSyntax(options);
    const response = await this.request('parse', { css, options });
    const root = response.result?.root;
    if (!root) throw new Error('postcss-go bridge parse response is missing root');
    return { root };
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    assertSupportedSyntax(options);
    const effectiveOptions = await this.resolveAnnotation(css, options);
    const normalized = normalizeProcessOptions(
      effectiveOptions as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const response = await this.request('process', {
      css,
      options: normalized,
    });
    return readProcessResult(response.result);
  }

  async noWork(css: string, options: ProcessOptions = {}): Promise<NoWorkResult> {
    assertSupportedSyntax(options);
    const effectiveOptions = await this.resolveAnnotation(css, options);
    const normalized = normalizeProcessOptions(
      effectiveOptions as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const response = await this.request('noWork', {
      css,
      options: normalized,
    });
    return readNoWorkResult(response.result);
  }

  async stringify(ast: AstNode): Promise<string> {
    return (await this.stringifyResult(ast)).css;
  }

  async stringifyResult(ast: AstNode, options: ProcessOptions = {}): Promise<AstStringifyResult> {
    assertSupportedSyntax(options);
    assertSupportedAst(ast);
    const preparedOptions = prepareStringifyOptions(ast, options);
    const effectiveOptions = await this.resolveStringifyAnnotation(ast, preparedOptions);
    const normalized = normalizeProcessOptions(
      effectiveOptions as NormalizeProcessOptionsInput,
      joinMapAnnotationPath,
    ) as ProcessOptions;
    const response = await this.request('stringify', { ast, options: normalized });
    if (typeof response.result?.css !== 'string') {
      throw new Error('postcss-go bridge stringify response is missing css');
    }
    return finalizeStringifyResult(
      { css: response.result.css, map: response.result.map },
      effectiveOptions,
      ast,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.bridge.close();
  }

  private async resolveAnnotation(css: string, options: ProcessOptions): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const parsed = await this.parse(css, { from: options.from });
    const root = asProcessRoot(fromAst(parsed.root));
    attachInputMetadata(root, css, { from: options.from });
    const annotation = await options.map.annotation(options.to, root as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  private async resolveStringifyAnnotation(
    root: AstNode,
    options: ProcessOptions,
  ): Promise<ProcessOptions> {
    if (
      !options.map ||
      typeof options.map !== 'object' ||
      typeof options.map.annotation !== 'function'
    ) {
      return options;
    }
    const live = asProcessRoot(fromAst(root));
    const annotation = await options.map.annotation(options.to, live as never);
    return { ...options, map: { ...options.map, annotation } };
  }

  private async request(
    method: BridgeMethod,
    params: BridgeParams,
  ): Promise<BridgeSuccessResponse> {
    if (this.closed) throw new Error('postcss-go bridge service is closed');
    return this.bridge.request(method, params);
  }
}

class BridgeTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly commandFactory: () => BridgeCommand) {}

  request(method: BridgeMethod, params: BridgeParams): Promise<BridgeSuccessResponse> {
    const child = this.ensureChild();
    const id = this.nextId++;
    const request: JsonRpcRequest<BridgeParams> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = new Promise<BridgeSuccessResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    try {
      child.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
    } catch (error) {
      this.pending.delete(id);
      throw bridgeError('write', error);
    }
    return response;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.closePromise) return this.closePromise;
    if (!this.child) {
      this.rejectPending(new Error('postcss-go bridge closed'));
      return;
    }

    const child = this.child;
    this.closePromise = new Promise<void>((resolveClose) => {
      child.once('close', () => resolveClose());
      child.kill();
    }).finally(() => {
      this.rejectPending(new Error('postcss-go bridge closed'));
      this.resetBuffers();
      this.child = null;
      this.closePromise = null;
    });
    return this.closePromise;
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.closed) throw new Error('postcss-go bridge is closed');
    if (this.child) return this.child;

    const command = this.commandFactory();
    const env =
      command.command === 'go'
        ? { ...process.env, GOFLAGS: withModFlag(process.env.GOFLAGS) }
        : process.env;
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env,
      stdio: 'pipe',
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    child.stdin.on('error', (error) => this.fail(bridgeError('write', error)));
    child.on('error', (error) => this.fail(bridgeError('process', error)));
    child.on('close', (code, signal) => {
      const detail =
        this.stderrBuffer.trim() || `exit code ${code ?? 'unknown'} signal ${signal ?? 'none'}`;
      this.fail(new Error(`postcss-go bridge exited: ${detail}`));
      this.child = null;
      this.resetBuffers();
    });

    this.child = child;
    return child;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleResponse(line);
    }
  }

  private handleResponse(line: string): void {
    let message: JsonRpcResponse<BridgeResult>;
    try {
      message = JSON.parse(line) as JsonRpcResponse<BridgeResult>;
    } catch (error) {
      this.fail(
        new Error(`postcss-go bridge returned invalid JSON-RPC: ${String(error)}\n${line}`, {
          cause: error,
        }),
      );
      return;
    }

    if (typeof message.id !== 'number') return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);

    if (message.error) request.reject(createBridgeError(message.error));
    else request.resolve({ jsonrpc: '2.0', id: message.id, result: message.result });
  }

  private fail(error: Error): void {
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private resetBuffers(): void {
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}

function readProcessResult(result?: BridgeResult): ProcessResult {
  if (!result?.root || typeof result.css !== 'string') {
    throw new Error('postcss-go bridge process response is incomplete');
  }
  return {
    css: result.css,
    map: result.map,
    root: result.root,
    messages: result.messages ?? [],
  };
}

function readNoWorkResult(result?: BridgeResult): NoWorkResult {
  if (!result || typeof result.css !== 'string') {
    throw new Error('postcss-go bridge noWork response is incomplete');
  }
  return { css: result.css, map: result.map };
}

function resolveBridgeCommand(options: NodePostcssGoService): BridgeCommand {
  const binPath = options.binPath ?? process.env.POSTCSS_GO_NODE_API_BIN;
  if (binPath) {
    return {
      command: binPath,
      args: options.binArgs ?? [],
      cwd: options.workingDirectory ?? process.cwd(),
    };
  }

  return {
    command: 'go',
    args: ['run', '-mod=mod', './cmd/api'],
    cwd: options.workingDirectory ?? resolve(defaultRepositoryRoot()),
  };
}

function defaultRepositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
}

function withModFlag(flags?: string): string {
  return flags?.includes('-mod=mod') ? flags : `${flags ? `${flags} ` : ''}-mod=mod`;
}

function bridgeError(operation: string, error: unknown): Error {
  return new Error(`postcss-go bridge ${operation} failed: ${String(error)}`, { cause: error });
}

function createBridgeError(payload: JsonRpcError): Error {
  const message = payload.message || 'postcss-go bridge returned an unknown JSON-RPC error';
  const input = new Input();
  input.css = payload.source ?? '';
  input.file = payload.file;
  const error =
    payload.name === 'CssSyntaxError'
      ? new CssSyntaxError(payload.reason ?? message, {
          ...payload,
          input,
        })
      : new Error(message);
  if (payload.name) error.name = payload.name;
  for (const key of [
    'reason',
    'line',
    'column',
    'endLine',
    'endColumn',
    'source',
    'file',
    'plugin',
  ] as const) {
    if (payload[key] !== undefined)
      Object.defineProperty(error, key, {
        configurable: true,
        enumerable: true,
        value: payload[key],
      });
  }
  return error;
}
