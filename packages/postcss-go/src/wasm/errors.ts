import { cssSyntaxErrorFromDto, type CssSyntaxErrorDTO } from '../errors.js';

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
export interface WasmErrorDTO extends CssSyntaxErrorDTO {
  code?: number;
}

/** Rebuild a structured error from a WASM Worker RPC error payload. */
export function errorFromWasmDto(dto: WasmErrorDTO): Error {
  if (dto.name === 'CssSyntaxError') {
    return cssSyntaxErrorFromDto(dto);
  }

  if (!dto.name || dto.name === 'WasmWorkerError') {
    return new WasmWorkerError(dto.message || 'postcss-go WASM request failed');
  }

  const error = new Error(dto.message || 'postcss-go WASM request failed');
  error.name = dto.name;
  return error;
}
