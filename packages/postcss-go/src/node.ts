import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PostcssGoService } from './service.js';
import type {
  AstNode,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  SourceMapOptions,
  Warning,
} from './types.js';

type BridgeMethod = 'parse' | 'process' | 'stringify';

type BridgeParams = { css: string; options?: ProcessOptions } | { ast: AstNode };

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
    const response = await this.request('parse', { css, options });
    const root = response.result?.root;
    if (!root) throw new Error('postcss-go bridge parse response is missing root');
    return { root };
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    const normalized = normalizeProcessOptions(options);
    const response = await this.request('process', {
      css,
      options: normalized.bridgeOptions,
    });
    const result = readProcessResult(response.result);
    return applySourceMapOutput(result, options, normalized.mapOptions);
  }

  async stringify(ast: AstNode): Promise<string> {
    const response = await this.request('stringify', { ast });
    const css = response.result?.css;
    if (typeof css !== 'string') {
      throw new Error('postcss-go bridge stringify response is missing css');
    }
    return css;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.bridge.close();
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

function normalizeProcessOptions(options: ProcessOptions): {
  bridgeOptions: ProcessOptions;
  mapOptions?: SourceMapOptions;
} {
  if (!options.map || typeof options.map === 'boolean') return { bridgeOptions: options };

  const mapOptions = options.map;
  const bridgeOptions: ProcessOptions = {
    ...options,
    map: true,
    absolute: mapOptions.absolute,
    preserveAnnotation: mapOptions.annotation === false,
    sourceMapFrom: mapOptions.from,
    sourcesContent: mapOptions.sourcesContent,
  };
  const previous =
    typeof mapOptions.prev === 'function' ? mapOptions.prev(options.from) : mapOptions.prev;
  if (previous === false) bridgeOptions.previousMapDisabled = true;
  else if (typeof previous === 'string') bridgeOptions.previousMap = previous;
  else if (previous) bridgeOptions.previousMap = JSON.stringify(previous);
  if (bridgeOptions.previousMap && !bridgeOptions.previousMapUrl) {
    bridgeOptions.previousMapUrl = `${options.from ?? options.to ?? 'to.css'}.map`;
  }
  if (!bridgeOptions.mapFile && typeof mapOptions.annotation === 'string' && options.to) {
    bridgeOptions.mapFile = join(dirname(options.to), mapOptions.annotation);
  }
  return { bridgeOptions, mapOptions };
}

function applySourceMapOutput(
  result: ProcessResult,
  options: ProcessOptions,
  mapOptions?: SourceMapOptions,
): ProcessResult {
  if (!result.map || !mapOptions) return result;
  if (mapOptions.inline === true) {
    const encoded = Buffer.from(result.map).toString('base64');
    return {
      ...result,
      css: `${result.css}\n/*# sourceMappingURL=data:application/json;base64,${encoded} */`,
      map: undefined,
    };
  }
  if (mapOptions.annotation === false || mapOptions.annotation === undefined) return result;

  const annotation =
    typeof mapOptions.annotation === 'function'
      ? mapOptions.annotation(options.to, result.root)
      : typeof mapOptions.annotation === 'string'
        ? mapOptions.annotation
        : basename(options.mapFile ?? `${options.to ?? options.from ?? 'to.css'}.map`);
  return { ...result, css: `${result.css}\n/*# sourceMappingURL=${annotation} */` };
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
  const error = new Error(
    payload.message || 'postcss-go bridge returned an unknown JSON-RPC error',
  );
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
