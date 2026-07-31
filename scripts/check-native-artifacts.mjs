#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NATIVE_TUPLES, nativeArtifactNames } from './native-tuples.mjs';

const mode = process.argv[2];
const manifestPath = resolve(process.argv[3] ?? 'native-artifacts.json');
const packageRoot = resolve(process.argv[4] ?? 'npm/postcss-go');

function collect() {
  return Object.fromEntries(
    NATIVE_TUPLES.map((tuple) => {
      const files = Object.fromEntries(
        nativeArtifactNames(tuple).map((name) => {
          const artifactPath = resolve(packageRoot, tuple, name);
          if (!existsSync(artifactPath)) {
            throw new Error(`native artifact is missing: ${artifactPath}`);
          }
          const stat = statSync(artifactPath);
          if (!stat.isFile() || stat.size === 0) {
            throw new Error(`native artifact is missing or empty: ${artifactPath}`);
          }
          const digest = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
          return [name, { bytes: stat.size, sha256: digest }];
        }),
      );
      return [tuple, files];
    }),
  );
}

if (mode === 'snapshot') {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(collect(), null, 2)}\n`);
  console.log(`postcss-go: snapshotted ${NATIVE_TUPLES.length} validated native artifacts`);
} else if (mode === 'verify') {
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = collect();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `validated native artifacts changed after installation:\nexpected ${JSON.stringify(expected, null, 2)}\nactual ${JSON.stringify(actual, null, 2)}`,
    );
  }
  console.log(
    `postcss-go: verified ${NATIVE_TUPLES.length} validated native artifacts are unchanged`,
  );
} else {
  throw new Error('usage: check-native-artifacts.mjs <snapshot|verify> [manifest] [package-root]');
}
