'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let bridgeDir = null;
let bridgeBinary = null;
let bridgeProcess = null;
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
  execFileSync(
    'go',
    ['build', '-mod=mod', '-o', bridgeBinary, './packages/postcss-compat/internal/bridge'],
    {
      cwd: repositoryRoot(),
      stdio: 'pipe',
    },
  );
  return bridgeBinary;
}

function cleanup() {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
  if (bridgeDir) fs.rmSync(bridgeDir, { recursive: true, force: true });
  bridgeDir = null;
  bridgeBinary = null;
}

function inputURL(file) {
  if (!file) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return file;
  return pathToFileURL(file).href;
}

function ensureProcess() {
  if (bridgeProcess) return bridgeProcess;
  bridgeProcess = spawn(ensureBinary(), ['--single'], {
    cwd: repositoryRoot(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  bridgeProcess.unref();
  bridgeProcess.stdin.unref();
  bridgeProcess.stdout.unref();
  bridgeProcess.stderr.unref();
  return bridgeProcess;
}

function readLineSync(fd) {
  const chunks = [];
  const byte = Buffer.allocUnsafe(1);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    let count;
    try {
      count = fs.readSync(fd, byte, 0, 1, null);
    } catch (error) {
      if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
      Atomics.wait(pause, 0, 0, 1);
      continue;
    }
    if (count === 0) throw new Error('postcss-go bridge closed its output');
    if (byte[0] === 10) return Buffer.concat(chunks).toString('utf8');
    chunks.push(Buffer.from(byte));
  }
}

function callSync(method, params) {
  const id = nextId++;
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
  const process = ensureProcess();
  let message;
  try {
    fs.writeSync(process.stdin._handle.fd, `${request}\n`);
    const output = readLineSync(process.stdout._handle.fd);
    message = JSON.parse(output);
  } catch (error) {
    bridgeProcess = null;
    process.kill();
    if (error instanceof SyntaxError) {
      throw new Error(`postcss-go bridge returned invalid JSON: ${error}`, { cause: error });
    }
    throw error;
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
  if (payload.input) {
    error.input = {
      column: payload.input.column,
      endColumn: undefined,
      endLine: undefined,
      endOffset: undefined,
      file: payload.input.file,
      line: payload.input.line,
      offset: payload.input.offset,
      source: payload.input.source,
      sourceMapPresent: payload.input.sourceMapPresent,
      url: inputURL(payload.input.file),
    };
  }
  return error;
}

module.exports = {
  callSync,
  createError: createBridgeError,
  close: cleanup,
};

process.once('exit', cleanup);
