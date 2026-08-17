import { CssSyntaxError } from '../errors.js';

/**
 * Raised for browser/WASM Worker setup and transport failures that callers can
 * handle without inspecting free-form message strings.
 */
export class WasmWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmWorkerError';
  }
}

/** Wire shape for Go `jsbridge.ErrorDTO` across the WASM Worker RPC. */
export interface WasmErrorDTO {
  code?: number;
  message?: string;
  name?: string;
  reason?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  file?: string;
  plugin?: string;
  input?: {
    source?: string;
    file?: string;
    line?: number;
    column?: number;
    offset?: number;
    sourceMapPresent?: boolean;
  };
}

/** Rebuild a structured error from a WASM Worker RPC error payload. */
export function errorFromWasmDto(dto: WasmErrorDTO): Error {
  if (dto.name === 'CssSyntaxError') {
    const reason = dto.reason || stripLeadingErrorName(dto.message) || 'Unknown error';
    return new CssSyntaxError(reason, {
      line: dto.line,
      column: dto.column,
      endLine: dto.endLine,
      endColumn: dto.endColumn,
      source: dto.source ?? dto.input?.source,
      file: dto.file ?? dto.input?.file,
      plugin: dto.plugin,
      input: dto.input
        ? {
            source: dto.input.source,
            file: dto.input.file,
            line: dto.input.line,
            column: dto.input.column,
            offset: dto.input.offset,
            sourceMapPresent: dto.input.sourceMapPresent,
          }
        : undefined,
    });
  }

  if (!dto.name || dto.name === 'WasmWorkerError') {
    return new WasmWorkerError(dto.message || 'postcss-go WASM request failed');
  }

  const error = new Error(dto.message || 'postcss-go WASM request failed');
  error.name = dto.name;
  return error;
}

function stripLeadingErrorName(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const match = message.match(/^CssSyntaxError:\s*(?:.*?:\d+:\d+:\s*)?(.*)$/);
  return match?.[1] ?? message;
}
