import path from 'node:path';

type BridgeClient = {
  callSync: (method: string, params: unknown) => unknown;
  createError: (payload: unknown) => Error;
};

const clientPath = process.env.POSTCSS_GO_COMPAT_BRIDGE_CLIENT;
if (!clientPath) {
  throw new Error('POSTCSS_GO_COMPAT_BRIDGE_CLIENT is required in Go compat mode');
}

const { callSync, createError } = require(path.resolve(clientPath)) as BridgeClient;

export function call(method: string, params: unknown): any {
  return callSync(method, params);
}

export function errorFromPayload(payload: unknown): Error {
  return createError(payload);
}
