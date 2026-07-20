import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import { createNodeService, NodePostcssGoService } from '../src/index.ts';

async function createBridgeScript(mode = 'success') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'postcss-go-core-test-'));
  const file = path.join(dir, 'bridge.mjs');
  const code = `
import readline from 'node:readline';

const mode = ${JSON.stringify(mode)};
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function root(css, options = {}) {
  return {
    type: 'root',
    source: options.from ? { file: options.from } : undefined,
    nodes: css.includes(':')
      ? [{ type: 'decl', prop: 'color', value: 'red' }]
      : [],
  };
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);

  if (mode === 'invalid-json') {
    process.stdout.write('not-json\\n');
    return;
  }

  if (mode === 'hang') {
    return;
  }

  if (mode === 'bridge-error') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: 'input.css:2:4: bridge failed',
        name: 'CssSyntaxError',
        reason: 'bridge failed',
        line: 2,
        column: 4,
        source: 'a {\\n  color: red;\\n}',
        file: 'input.css',
      },
    }) + '\\n');
    return;
  }

  if (mode === 'missing-root') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { css: request.params.css ?? '' },
    }) + '\\n');
    return;
  }

  if (mode === 'missing-css') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { root: root(request.params.css, request.params.options) },
    }) + '\\n');
    return;
  }

  if (request.method === 'parse') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { root: root(request.params.css, request.params.options) },
    }) + '\\n');
    return;
  }

  if (request.method === 'process') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        css: request.params.css.toUpperCase(),
        map: request.params.options?.map ? '{"version":3,"sources":[],"names":[],"mappings":""}' : undefined,
        root: root(request.params.css, request.params.options),
        messages: [{ type: 'warning', text: 'processed' }],
      },
    }) + '\\n');
    return;
  }

  if (request.method === 'stringify') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { css: '.from-ast { color: blue; }' },
    }) + '\\n');
  }
});
`;
  await fs.writeFile(file, code, 'utf8');
  return file;
}

function createService(mode = 'success') {
  return createBridgeScript(mode).then(
    (script) =>
      new NodePostcssGoService({
        binPath: process.execPath,
        binArgs: [script],
      }),
  );
}

test('createNodeService returns a NodePostcssGoService instance', () => {
  const service = createNodeService({ binPath: process.execPath, binArgs: ['--version'] });
  expect(service).toBeInstanceOf(NodePostcssGoService);
});

test('NodePostcssGoService parses, processes, and stringifies through the bridge', async () => {
  const service = await createService();

  const parsed = await service.parse('.a { color: red; }', { from: 'input.css' });
  expect(parsed.root.type).toBe('root');
  expect(parsed.root.source.file).toBe('input.css');

  const processed = await service.process('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: true,
  });
  expect(processed.css).toBe('.A { COLOR: RED; }');
  expect(processed.map).toContain('"version":3');
  expect(processed.messages).toEqual([{ type: 'warning', text: 'processed' }]);

  const css = await service.stringify({ type: 'root', nodes: [] });
  expect(css).toBe('.from-ast { color: blue; }');

  await service.close();
});

test('NodePostcssGoService supports object source map options', async () => {
  const service = await createService();
  const inline = await service.process('.a { color: red; }', {
    from: 'input.css',
    map: { inline: true, sourcesContent: false },
  });
  expect(inline.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(inline.map).toBeUndefined();

  const annotated = await service.process('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: {
      annotation(file, root) {
        expect(file).toBe('output.css');
        expect(root.type).toBe('root');
        return 'maps/custom.map';
      },
      inline: false,
      prev: false,
    },
  });
  expect(annotated.css).toContain('sourceMappingURL=maps/custom.map');
  expect(annotated.map).toContain('"version":3');

  await service.close();
});

test('NodePostcssGoService rejects invalid bridge payloads', async () => {
  const parseService = await createService('missing-root');
  await expect(parseService.parse('a{}')).rejects.toThrow(/missing root/);
  await parseService.close();

  const processService = await createService('missing-css');
  await expect(processService.process('a{}')).rejects.toThrow(/process response is incomplete/);
  await processService.close();
});

test('NodePostcssGoService surfaces bridge errors and invalid JSON', async () => {
  const errorService = await createService('bridge-error');
  const error = await errorService.parse('a{}').catch((value) => value);
  expect(error).toMatchObject({
    name: 'CssSyntaxError',
    reason: 'bridge failed',
    line: 2,
    column: 4,
    file: 'input.css',
  });
  await errorService.close();

  const invalidJsonService = await createService('invalid-json');
  await expect(invalidJsonService.parse('a{}')).rejects.toThrow(/invalid JSON-RPC/);
  await invalidJsonService.close();
});

test('NodePostcssGoService rejects pending requests when closed', async () => {
  const service = await createService('hang');
  const pending = service.parse('a{}');

  await service.close();
  await expect(pending).rejects.toThrow(/bridge (closed|exited)/);
});

test('NodePostcssGoService cannot be used after close', async () => {
  const service = await createService();
  await service.close();

  await expect(service.parse('a{}')).rejects.toThrow(/service is closed/);
});
