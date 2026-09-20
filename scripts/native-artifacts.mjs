#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NATIVE_TUPLES, nativeArtifactNames } from './native-platforms.mjs';

function requireFile(path) {
  const stat = existsSync(path) ? statSync(path) : undefined;
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`native artifact is missing: ${path}`);
  }
  return stat;
}

function collect(packageRoot) {
  return Object.fromEntries(
    NATIVE_TUPLES.map((tuple) => {
      const files = Object.fromEntries(
        nativeArtifactNames(tuple).map((name) => {
          const artifactPath = resolve(packageRoot, tuple, name);
          const stat = requireFile(artifactPath);
          return [
            name,
            {
              bytes: stat.size,
              sha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
            },
          ];
        }),
      );
      return [tuple, files];
    }),
  );
}

function snapshot(manifestPath, packageRoot) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(collect(packageRoot), null, 2)}\n`);
  console.log(`postcss-go: snapshotted ${NATIVE_TUPLES.length} validated native artifacts`);
}

function verify(manifestPath, packageRoot) {
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = collect(packageRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `validated native artifacts changed after snapshot:\nexpected ${JSON.stringify(expected, null, 2)}\nactual ${JSON.stringify(actual, null, 2)}`,
    );
  }
  console.log(
    `postcss-go: verified ${NATIVE_TUPLES.length} validated native artifacts are unchanged`,
  );
}

function usage() {
  throw new Error(
    'usage: native-artifacts.mjs <snapshot|verify> [args]\n' +
      '  snapshot [manifest] [package-root]\n' +
      '  verify [manifest] [package-root]',
  );
}

const [command, ...args] = process.argv.slice(2);
const packageRoot = resolve(args[1] ?? 'npm/postcss-go');
if (command === 'snapshot') {
  snapshot(resolve(args[0] ?? 'native-artifacts.json'), packageRoot);
} else if (command === 'verify') {
  verify(resolve(args[0] ?? 'native-artifacts.json'), packageRoot);
} else {
  usage();
}
