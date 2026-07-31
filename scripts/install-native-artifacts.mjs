#!/usr/bin/env node

/**
 * Places native addons downloaded from the build matrix into their platform
 * package directories before Changesets packs and publishes the workspace.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { NATIVE_TUPLES } from './native-tuples.mjs';

const source = resolve(process.argv[2] ?? 'native-artifacts');
const destination = resolve(process.argv[3] ?? 'npm/postcss-go');
const pattern = /^postcss-go\.(.+)\.node$/;
const expectedTuples = new Set(NATIVE_TUPLES);
const installedTuples = new Set();

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
    if (installedTuples.has(tuple)) {
      throw new Error(`duplicate native artifact tuple ${tuple}: ${path}`);
    }
    const packageDirectory = resolve(destination, tuple);
    mkdirSync(packageDirectory, { recursive: true });
    copyFileSync(path, resolve(packageDirectory, basename(path)));
    installedTuples.add(tuple);
  }
}

visit(source);
const missing = [...expectedTuples].filter((tuple) => !installedTuples.has(tuple));
if (missing.length > 0) {
  throw new Error(`missing native artifact tuples from ${source}: ${missing.join(', ')}`);
}
console.log(`postcss-go: installed ${installedTuples.size} native artifacts`);
