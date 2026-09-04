'use strict';

const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let bridgeDir = null;
let bridgeBinary = null;
let bridgeProcess = null;
let nextId = 1;
/** null = unknown; false = persistent stdio fds work; true = use one-shot spawnSync (Windows). */
let useSpawnSync = process.env.POSTCSS_GO_COMPAT_SPAWN_SYNC === '1' ? true : null;

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
  useSpawnSync = process.env.POSTCSS_GO_COMPAT_SPAWN_SYNC === '1' ? true : null;
}

function close() {
  process.removeListener('exit', cleanup);
  cleanup();
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

function pipeFd(stream) {
  const fd = stream?.fd ?? stream?._handle?.fd;
  return typeof fd === 'number' && fd >= 0 ? fd : -1;
}

function readLineSync(fd) {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    let count;
    try {
      count = fs.readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
      Atomics.wait(pause, 0, 0, 1);
      continue;
    }
    if (count === 0) throw new Error('postcss-go bridge closed its output');
    const newline = buffer.indexOf(10, 0);
    if (newline >= 0 && newline < count) {
      chunks.push(Buffer.from(buffer.subarray(0, newline)));
      return Buffer.concat(chunks).toString('utf8');
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
}

function writeAllSync(fd, text) {
  const data = Buffer.from(text);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let offset = 0;
  while (offset < data.length) {
    try {
      const written = fs.writeSync(fd, data, offset, data.length - offset, null);
      if (written === 0) {
        Atomics.wait(pause, 0, 0, 1);
        continue;
      }
      offset += written;
    } catch (error) {
      if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
      Atomics.wait(pause, 0, 0, 1);
    }
  }
}

function parseBridgeMessage(output, error) {
  let message;
  try {
    message = JSON.parse(output);
  } catch (parseError) {
    if (error) {
      throw new Error(`postcss-go bridge returned invalid JSON: ${parseError}`, {
        cause: parseError,
      });
    }
    throw parseError;
  }
  if (message.error) {
    throw createBridgeError(message.error);
  }
  return message.result;
}

/** Windows pipes expose fd=-1, so fs.writeSync/readSync cannot drive a long-lived child. */
function callSyncSpawn(request) {
  const result = spawnSync(ensureBinary(), ['--single'], {
    cwd: repositoryRoot(),
    input: `${request}\n`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      (result.stderr && String(result.stderr).trim()) ||
        `postcss-go bridge exited with code ${result.status}`,
    );
  }
  const output = String(result.stdout)
    .split(/\r?\n/)
    .find((line) => line.length > 0);
  if (!output) throw new Error('postcss-go bridge closed its output');
  return parseBridgeMessage(output, true);
}

// JSON.stringify recurses and overflows around a few thousand nested AST
// nodes. The compatibility contract intentionally exercises deeper trees, so
// serialize plain bridge payloads with an explicit stack.
function stringifyDeep(value) {
  let output = '';
  const stack = [{ kind: 'value', value, inArray: false }];
  const ancestors = new WeakSet();

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry.kind === 'text') {
      output += entry.value;
      continue;
    }
    if (entry.kind === 'leave') {
      ancestors.delete(entry.value);
      continue;
    }

    const current = entry.value;
    if (current === null || typeof current !== 'object') {
      const encoded = JSON.stringify(current);
      output += encoded === undefined ? (entry.inArray ? 'null' : '') : encoded;
      continue;
    }

    if (ancestors.has(current)) {
      throw new TypeError('Converting circular structure to JSON');
    }
    ancestors.add(current);

    if (Array.isArray(current)) {
      output += '[';
      stack.push({ kind: 'leave', value: current });
      stack.push({ kind: 'text', value: ']' });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: 'value', value: current[index], inArray: true });
        if (index > 0) stack.push({ kind: 'text', value: ',' });
      }
      continue;
    }

    const keys = Object.keys(current).filter((key) => {
      const type = typeof current[key];
      return type !== 'undefined' && type !== 'function' && type !== 'symbol';
    });
    output += '{';
    stack.push({ kind: 'leave', value: current });
    stack.push({ kind: 'text', value: '}' });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      stack.push({ kind: 'value', value: current[key], inArray: false });
      stack.push({ kind: 'text', value: ':' });
      stack.push({ kind: 'text', value: JSON.stringify(key) });
      if (index > 0) stack.push({ kind: 'text', value: ',' });
    }
  }

  return output;
}

function callSync(method, params) {
  const id = nextId++;
  const request = stringifyDeep({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });

  if (useSpawnSync === true) {
    return callSyncSpawn(request);
  }

  const child = ensureProcess();
  const stdinFd = pipeFd(child.stdin);
  const stdoutFd = pipeFd(child.stdout);
  if (stdinFd < 0 || stdoutFd < 0) {
    useSpawnSync = true;
    bridgeProcess = null;
    child.kill();
    return callSyncSpawn(request);
  }
  useSpawnSync = false;

  let output;
  try {
    writeAllSync(stdinFd, `${request}\n`);
    output = readLineSync(stdoutFd);
  } catch (error) {
    bridgeProcess = null;
    child.kill();
    throw error;
  }

  let message;
  try {
    message = JSON.parse(output);
  } catch (parseError) {
    bridgeProcess = null;
    child.kill();
    throw new Error(`postcss-go bridge returned invalid JSON: ${parseError}`, {
      cause: parseError,
    });
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
  close,
};

process.once('exit', cleanup);
