import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type PostcssGoService } from './service.js';
import type {
  AstNode,
  ParseResult,
  ProcessOptions,
  ProcessResult,
  SourceMapOptions,
} from './types.js';

export interface NodePostcssGoServiceOptions {
  binPath?: string;
  binArgs?: string[];
  workingDirectory?: string;
}

export class NodePostcssGoService implements PostcssGoService {
  readonly binPath?: string;
  readonly binArgs?: string[];
  readonly workingDirectory?: string;

  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: BridgeSuccessResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: NodePostcssGoServiceOptions = {}) {
    this.binPath = options.binPath;
    this.binArgs = options.binArgs;
    this.workingDirectory = options.workingDirectory;
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    const response = await this.invoke('parse', { css, options });
    if (!response.result?.root) {
      throw new Error('postcss-go bridge parse response is missing root');
    }
    return { root: response.result.root };
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    const { bridgeOptions, mapOptions } = normalizeProcessOptions(options);
    const response = await this.invoke('process', { css, options: bridgeOptions });
    if (!response.result?.root || typeof response.result.css !== 'string') {
      throw new Error('postcss-go bridge process response is incomplete');
    }
    const result: ProcessResult = {
      css: response.result.css,
      map: response.result.map,
      root: response.result.root,
      messages: response.result.messages ?? [],
    };
    return applySourceMapOutput(result, options, mapOptions);
  }

  async stringify(ast: AstNode): Promise<string> {
    const response = await this.invoke('stringify', { ast });
    if (typeof response.result?.css !== 'string') {
      throw new Error('postcss-go bridge stringify response is missing css');
    }
    return response.result.css;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.closePromise) {
      return this.closePromise;
    }
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.closePromise = new Promise<void>((resolvePromise) => {
      child.once('close', () => resolvePromise());
      child.kill();
    }).finally(() => {
      this.rejectAllPending(new Error('postcss-go bridge closed'));
      this.child = null;
      this.closePromise = null;
      this.stdoutBuffer = '';
      this.stderrBuffer = '';
    });

    return this.closePromise;
  }

  private async invoke(method: BridgeMethod, params: BridgeParams): Promise<BridgeSuccessResponse> {
    const child = this.ensureChild();
    const id = this.nextId++;
    const request: JsonRpcRequest<BridgeParams> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const responsePromise = new Promise<BridgeSuccessResponse>((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });

    try {
      child.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
    } catch (error) {
      this.pending.delete(id);
      throw new Error(`postcss-go bridge write failed: ${String(error)}`, { cause: error });
    }
    return responsePromise;
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.closed) {
      throw new Error('postcss-go bridge service is closed');
    }
    if (this.child) {
      return this.child;
    }

    const { command, args, cwd } = this.resolveCommand();
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        GOFLAGS: process.env.GOFLAGS ? `${process.env.GOFLAGS} -mod=mod` : '-mod=mod',
      },
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stdin.on('error', (error) => {
      this.rejectAllPending(
        new Error(`postcss-go bridge write failed: ${error.message}`, { cause: error }),
      );
    });
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    child.on('error', (error) => {
      this.rejectAllPending(
        new Error(`postcss-go bridge process error: ${error.message}`, { cause: error }),
      );
    });
    child.on('close', (code, signal) => {
      const detail =
        this.stderrBuffer.trim() || `exit code ${code ?? 'unknown'} signal ${signal ?? 'none'}`;
      this.rejectAllPending(new Error(`postcss-go bridge exited: ${detail}`));
      this.child = null;
      this.stdoutBuffer = '';
      this.stderrBuffer = '';
    });

    this.child = child;
    return child;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.handleMessage(line);
    }
  }

  private handleMessage(line: string): void {
    let message: JsonRpcResponse<BridgeResult>;
    try {
      message = JSON.parse(line) as JsonRpcResponse<BridgeResult>;
    } catch (error) {
      this.rejectAllPending(
        new Error(`postcss-go bridge returned invalid JSON-RPC: ${String(error)}\n${line}`, {
          cause: error,
        }),
      );
      return;
    }

    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(createBridgeError(message.error));
      return;
    }

    pending.resolve({
      jsonrpc: '2.0',
      id: message.id,
      result: message.result,
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private resolveCommand(): { command: string; args: string[]; cwd: string } {
    const binPath = this.binPath ?? process.env.POSTCSS_GO_NODE_API_BIN;

    if (binPath) {
      return {
        command: binPath,
        args: this.binArgs ?? [],
        cwd: this.workingDirectory ?? process.cwd(),
      };
    }

    const cwd = this.workingDirectory ?? resolve(defaultRepositoryRoot());
    return {
      command: 'go',
      args: ['run', '-mod=mod', './cmd/api'],
      cwd,
    };
  }
}

function normalizeProcessOptions(options: ProcessOptions): {
  bridgeOptions: ProcessOptions;
  mapOptions?: SourceMapOptions;
} {
  if (!options.map || typeof options.map === 'boolean') {
    return { bridgeOptions: options };
  }

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
  if (previous === false) {
    bridgeOptions.previousMapDisabled = true;
  } else if (typeof previous === 'string') {
    bridgeOptions.previousMap = previous;
  } else if (previous) {
    bridgeOptions.previousMap = JSON.stringify(previous);
  }
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
    return {
      ...result,
      css: `${result.css}\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(result.map).toString('base64')} */`,
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

type BridgeMethod = 'parse' | 'process' | 'stringify';

type BridgeParams =
  | {
      css: string;
      options?: ProcessOptions;
    }
  | {
      ast: AstNode;
    };

interface BridgeResult {
  css?: string;
  map?: string;
  root?: ParseResult['root'];
  messages?: ProcessResult['messages'];
}

interface JsonRpcRequest<TParams> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: TParams;
}

interface JsonRpcError {
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
    if (payload[key] !== undefined) {
      Object.defineProperty(error, key, {
        configurable: true,
        enumerable: true,
        value: payload[key],
      });
    }
  }
  return error;
}

interface JsonRpcResponse<TResult> {
  jsonrpc: '2.0';
  id: number | null;
  result?: TResult;
  error?: JsonRpcError;
}

interface BridgeSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result?: BridgeResult;
}

function defaultRepositoryRoot(): string {
  const filePath = fileURLToPath(import.meta.url);
  return resolve(dirname(filePath), '../../../');
}
