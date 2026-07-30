#!/usr/bin/env node
/**
 * Regenerate packages/postcss-go/test/upstream-ast-contract/*.test.ts from
 * vendor/postcss/test Node/Container AST suites.
 *
 * Manual adaptations in helpers.ts, document.test.ts, fromJSON.test.ts, and a
 * few async/LazyResult-aware cases in node/root tests are preserved by only
 * rewriting the generated files listed below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcDir = path.join(repoRoot, 'vendor', 'postcss', 'test');
const outDir = path.join(repoRoot, 'packages', 'postcss-go', 'test', 'upstream-ast-contract');

const FILES = [
  'node.test.ts',
  'container.test.ts',
  'rule.test.ts',
  'at-rule.test.ts',
  'declaration.test.ts',
  'comment.test.ts',
  'root.test.ts',
];

const HEADER = `import { test } from 'vitest'
import {
  AtRule,
  Comment,
  Container,
  CssSyntaxError,
  Declaration,
  Document,
  Input,
  Node,
  Result,
  Root,
  Rule,
  Warning,
  fromJSON,
  list,
  parse,
  postcss,
  stringify,
  equal,
  is,
  instance,
  match,
  not,
  ok,
  throws,
  type,
  type AnyNode,
  type Plugin,
} from './helpers.ts'
`;

function stripLeadingImports(text) {
  const lines = text.split('\n');
  let i = 0;
  const kept = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (!line.startsWith('import ')) break;
    const start = i;
    while (i < lines.length && !lines[i].includes(' from ')) i += 1;
    if (i < lines.length) i += 1;
    const block = lines.slice(start, i).join('\n');
    if (
      !block.includes("'uvu'") &&
      !block.includes('uvu/assert') &&
      !block.includes('../lib/postcss.js') &&
      !block.includes('../lib/document.js')
    ) {
      kept.push(block);
    }
  }
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return { kept, body: lines.slice(i).join('\n') };
}

for (const name of FILES) {
  const raw = fs.readFileSync(path.join(srcDir, name), 'utf8');
  const { kept, body: rawBody } = stripLeadingImports(raw);
  let body = rawBody.replace(/\ntest\.run\(\)\s*$/, '\n');

  // Explicit sync/async adaptations for postcss-go (no LazyResult).
  if (name === 'node.test.ts') {
    body = body.replace(
      /test\('warn\(\) accepts options', \(\) => \{([\s\S]*?)let result = postcss\(\[warner\]\)\.process\('a\{\}'\)/,
      "test('warn() accepts options', async () => {$1let result = await postcss([warner]).process('a{}')",
    );
  }
  if (name === 'root.test.ts') {
    body = body.replace(
      /test\('generates result with map', \(\) => \{([\s\S]*?)let result = root\.toResult\(\{ map: true \}\)/,
      "test('generates result with map', async () => {$1let result = await root.toResult({ map: true })",
    );
  }

  const parts = [HEADER.trimEnd(), ''];
  if (kept.length) {
    parts.push(...kept, '');
  }
  parts.push(body.endsWith('\n') ? body : `${body}\n`);
  fs.writeFileSync(path.join(outDir, name), parts.join('\n'));
  console.log(`wrote ${name}`);
}

console.log('Preserved manually: helpers.ts, document.test.ts, fromJSON.test.ts');
