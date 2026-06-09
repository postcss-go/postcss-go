'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let child = null;
let stdoutFd = null;
let nextId = 1;
let stdoutBuffer = '';

function repositoryRoot() {
  return path.resolve(__dirname, '../..');
}

function ensureChild() {
  if (child) {
    return child;
  }

  child = spawn('go', ['run', './cmd/postcss-go-node-api'], {
    cwd: repositoryRoot(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  stdoutFd = child.stdout.fd;
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
  child.on('close', () => {
    child = null;
    stdoutFd = null;
    stdoutBuffer = '';
  });

  return child;
}

function readLineSync() {
  ensureChild();

  while (true) {
    const newlineIndex = stdoutBuffer.indexOf('\n');
    if (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      return line;
    }

    const chunk = Buffer.alloc(4096);
    const bytesRead = fs.readSync(stdoutFd, chunk, 0, chunk.length, null);
    if (bytesRead <= 0) {
      throw new Error('postcss-go bridge stdout closed unexpectedly');
    }
    stdoutBuffer += chunk.toString('utf8', 0, bytesRead);
  }
}

function callSync(method, params) {
  const id = nextId++;
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  ensureChild().stdin.write(`${JSON.stringify(request)}\n`);

  while (true) {
    const line = readLineSync().trim();
    if (!line) {
      continue;
    }

    const message = JSON.parse(line);
    if (message.id !== id) {
      continue;
    }
    if (message.error) {
      const error = new Error(message.error.message || 'postcss-go bridge error');
      error.name = 'CssSyntaxError';
      throw error;
    }
    return message.result;
  }
}

module.exports = {
  callSync,
  close() {
    if (child) {
      child.kill();
      child = null;
      stdoutFd = null;
      stdoutBuffer = '';
    }
  },
};
