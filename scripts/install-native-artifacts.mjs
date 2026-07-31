#!/usr/bin/env node

/**
 * Places native addons downloaded from the build matrix into their platform
 * package directories before Changesets packs and publishes the workspace.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { NATIVE_TUPLES, nativeArtifactNames } from './native-tuples.mjs';

const source = resolve(process.argv[2] ?? 'native-artifacts');
const destination = resolve(process.argv[3] ?? 'npm/postcss-go');
const pattern = /^postcss-go\.(.+)\.node$/;
const expectedTuples = new Set(NATIVE_TUPLES);
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
    const stat = existsSync(artifactPath) ? statSync(artifactPath) : undefined;
    if (!stat?.isFile() || stat.size === 0) {
      throw new Error(`native artifact is missing: ${artifactPath}`);
    }
    copyFileSync(artifactPath, resolve(packageDirectory, name));
  }
}
console.log(`postcss-go: installed ${addonDirectories.size} native artifact sets`);
