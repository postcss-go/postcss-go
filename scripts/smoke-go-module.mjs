#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = 'github.com/postcss-go/postcss-go';
const smokeDir = mkdtempSync(resolve(tmpdir(), 'postcss-go-module-smoke-'));

function run(command, args, options = {}) {
  execSync([command, ...args].join(' '), {
    cwd: options.cwd ?? smokeDir,
    stdio: 'inherit',
    env: { ...process.env, GOFLAGS: '-mod=mod', ...options.env },
  });
}

try {
  run('go', ['mod', 'init', 'example.com/postcss-go-smoke']);
  run('go', ['mod', 'edit', `-replace=${modulePath}=${repoRoot}`]);
  writeFileSync(
    resolve(smokeDir, 'main.go'),
    `package main

import (
\t"fmt"
\t"log"

\tpostcss "${modulePath}/pkg/api"
)

func main() {
\troot, err := postcss.Parse(".btn { color: red; }")
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tresult, err := postcss.New().Process(postcss.Stringify(root), postcss.ProcessOptions{
\t\tFrom: "input.css",
\t\tTo:   "output.css",
\t})
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tfmt.Println(result.CSS)
}
`,
  );
  run('go', ['run', '.']);
  console.log(`postcss-go: external Go module smoke passed (${modulePath}/pkg/api)`);
} finally {
  rmSync(smokeDir, { recursive: true, force: true });
}
