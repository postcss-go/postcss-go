#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { NATIVE_TUPLES, nativeArtifactNames } from './native-platforms.mjs';

const expectedTuples = new Set(NATIVE_TUPLES);

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

function install(source, destination) {
  const pattern = /^postcss-go\.(.+)\.node$/;
  const addonDirectories = new Map();

  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
        continue;
      }
      const match = pattern.exec(basename(path));
      if (!match) continue;
      const tuple = match[1];
      if (!expectedTuples.has(tuple)) {
        throw new Error(`unexpected native artifact tuple ${tuple}: ${path}`);
      }
      if (addonDirectories.has(tuple)) {
        throw new Error(`duplicate native artifact tuple ${tuple}: ${path}`);
      }
      addonDirectories.set(tuple, dirname(path));
    }
  }

  visit(source);
  const missing = [...expectedTuples].filter((tuple) => !addonDirectories.has(tuple));
  if (missing.length > 0) {
    throw new Error(`missing native artifact tuples from ${source}: ${missing.join(', ')}`);
  }
  for (const [tuple, artifactDirectory] of addonDirectories) {
    const packageDirectory = resolve(destination, tuple);
    mkdirSync(packageDirectory, { recursive: true });
    for (const name of nativeArtifactNames(tuple)) {
      const artifactPath = resolve(artifactDirectory, name);
      requireFile(artifactPath);
      copyFileSync(artifactPath, resolve(packageDirectory, name));
    }
  }
  console.log(`postcss-go: installed ${addonDirectories.size} native artifact sets`);
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
      `validated native artifacts changed after installation:\nexpected ${JSON.stringify(expected, null, 2)}\nactual ${JSON.stringify(actual, null, 2)}`,
    );
  }
  console.log(
    `postcss-go: verified ${NATIVE_TUPLES.length} validated native artifacts are unchanged`,
  );
}

function usage() {
  throw new Error(
    'usage: native-artifacts.mjs <install|snapshot|verify> [args]\n' +
      '  install [source] [destination]\n' +
      '  snapshot [manifest] [package-root]\n' +
      '  verify [manifest] [package-root]',
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === 'install') {
  install(resolve(args[0] ?? 'native-artifacts'), resolve(args[1] ?? 'npm/postcss-go'));
} else if (command === 'snapshot') {
  snapshot(resolve(args[0] ?? 'native-artifacts.json'), resolve(args[1] ?? 'npm/postcss-go'));
} else if (command === 'verify') {
  verify(resolve(args[0] ?? 'native-artifacts.json'), resolve(args[1] ?? 'npm/postcss-go'));
} else {
  usage();
}
