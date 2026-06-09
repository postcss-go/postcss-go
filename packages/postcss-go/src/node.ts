import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type PostcssGoService } from './service.js';
import type { AstNode, ParseResult, ProcessOptions, ProcessResult } from './types.js';

export interface NodePostcssGoServiceOptions {
  binPath?: string;
  binArgs?: string[];
  workingDirectory?: string;
}

export class NodePostcssGoService implements PostcssGoService {
  readonly binPath?: string;
  readonly binArgs?: string[];
  readonly workingDirectory?: string;

  constructor(options: NodePostcssGoServiceOptions = {}) {
    this.binPath = options.binPath;
    this.binArgs = options.binArgs;
    this.workingDirectory = options.workingDirectory;
  }

  async parse(css: string, options: ProcessOptions = {}): Promise<ParseResult> {
    const response = await this.invoke({
      command: 'parse',
      css,
      options,
    });
    if (!response.root) {
      throw new Error('postcss-go bridge parse response is missing root');
    }
    return { root: response.root };
  }

  async process(css: string, options: ProcessOptions = {}): Promise<ProcessResult> {
    const response = await this.invoke({
      command: 'process',
      css,
      options,
    });
    if (!response.root || typeof response.css !== 'string') {
      throw new Error('postcss-go bridge process response is incomplete');
    }
    return {
      css: response.css,
      root: response.root,
      messages: response.messages ?? [],
    };
  }

  async stringify(ast: AstNode): Promise<string> {
    const response = await this.invoke({
      command: 'stringify',
      ast,
    });
    if (typeof response.css !== 'string') {
      throw new Error('postcss-go bridge stringify response is missing css');
    }
    return response.css;
  }

  async close(): Promise<void> {}

  private async invoke(payload: BridgeRequest): Promise<BridgeSuccessResponse> {
    const { command, args, cwd } = this.resolveCommand();

    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const input = JSON.stringify(payload);
    child.stdin.write(input);
    child.stdin.end();

    const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
      child.on('error', rejectPromise);
      child.on('close', (code) => resolvePromise(code ?? 1));
    });

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    if (exitCode !== 0) {
      throw new Error(
        `postcss-go bridge failed with exit code ${exitCode}: ${stderr || stdout || 'unknown error'}`,
      );
    }

    let response: BridgeEnvelope;
    try {
      response = JSON.parse(stdout) as BridgeEnvelope;
    } catch (error) {
      throw new Error(`postcss-go bridge returned invalid JSON: ${String(error)}\n${stdout}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new Error(response.error?.message ?? 'postcss-go bridge returned an unknown error');
    }

    return response as BridgeSuccessResponse;
  }

  private resolveCommand(): { command: string; args: string[]; cwd: string } {
    if (this.binPath) {
      return {
        command: this.binPath,
        args: this.binArgs ?? [],
        cwd: this.workingDirectory ?? process.cwd(),
      };
    }

    const cwd = this.workingDirectory ?? resolve(defaultRepositoryRoot());
    return {
      command: 'go',
      args: ['run', './cmd/postcss-go-node-api'],
      cwd,
    };
  }
}

interface BridgeRequest {
  command: 'parse' | 'process' | 'stringify';
  css?: string;
  ast?: AstNode;
  options?: ProcessOptions;
}

interface BridgeError {
  message: string;
}

interface BridgeEnvelope {
  ok: boolean;
  error?: BridgeError;
  css?: string;
  root?: ParseResult['root'];
  messages?: ProcessResult['messages'];
}

interface BridgeSuccessResponse extends BridgeEnvelope {
  ok: true;
}

function defaultRepositoryRoot(): string {
  const filePath = fileURLToPath(import.meta.url);
  return resolve(dirname(filePath), '../../../');
}
