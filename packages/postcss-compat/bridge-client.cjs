'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let bridgeDir = null;
let bridgeBinary = null;
let nextId = 1;

function repositoryRoot() {
  return path.resolve(__dirname, '../..');
}

function ensureBinary() {
  if (bridgeBinary) return bridgeBinary;

  const envBinary = process.env.POSTCSS_GO_COMPAT_BRIDGE_BIN;
  if (envBinary) {
    bridgeBinary = envBinary;
    return bridgeBinary;
  }

  bridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcss-go-compat-'));
  bridgeBinary = path.join(
    bridgeDir,
    process.platform === 'win32' ? 'postcss-go-api.exe' : 'postcss-go-api',
  );
  execFileSync('go', ['build', '-mod=mod', '-o', bridgeBinary, './cmd/api'], {
    cwd: repositoryRoot(),
    stdio: 'pipe',
  });
  return bridgeBinary;
}

function cleanup() {
  if (bridgeDir) fs.rmSync(bridgeDir, { recursive: true, force: true });
  bridgeDir = null;
  bridgeBinary = null;
}

function callSync(method, params) {
  const id = nextId++;
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
  const result = spawnSync(ensureBinary(), ['--single'], {
    cwd: repositoryRoot(),
    input: `${request}\n`,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'postcss-go bridge failed');
  }

  let message;
  try {
    message = JSON.parse(String(result.stdout).trim());
  } catch (error) {
    throw new Error(`postcss-go bridge returned invalid JSON: ${String(error)}`, { cause: error });
  }
  if (message.error) {
    throw createBridgeError(message.error);
  }
  return message.result;
}

function createBridgeError(payload) {
  const error = new Error(payload.message || 'postcss-go bridge error');
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
  ]) {
    if (payload[key] !== undefined) error[key] = payload[key];
  }
  return error;
}

module.exports = {
  callSync,
  close: cleanup,
};

process.once('exit', cleanup);
