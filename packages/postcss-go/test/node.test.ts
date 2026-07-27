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
import fs from 'node:fs';
import path from 'node:path';

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

function mapState(css, options = {}) {
  const matches = [...css.matchAll(/\\/\\*\\s*# sourceMappingURL=([\\s\\S]*?)\\*\\//g)];
  const annotation = matches.length ? matches[matches.length - 1][1].trim() : undefined;
  let loaded = Boolean(options.previousMap);
  if (options.previousMapPath) {
    try {
      JSON.parse(fs.readFileSync(options.previousMapPath, 'utf8'));
      loaded = true;
    } catch {}
  } else if (!options.previousMapDisabled && annotation?.startsWith('data:')) {
    loaded = true;
  } else if (!options.previousMapDisabled && annotation && options.from) {
    try {
      JSON.parse(fs.readFileSync(path.join(path.dirname(options.from), annotation), 'utf8'));
      loaded = true;
    } catch {}
  }
  const enabled = Boolean(options.map || (options.mapAuto && loaded));
  const inline = Boolean(
    options.mapInline || (options.mapInlineAuto && (!loaded || annotation?.startsWith('data:'))),
  );
  return { enabled, inline };
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
    const options = request.params.options ?? {};
    const state = mapState(request.params.css, options);
    let css = request.params.css.toUpperCase();
    let map = state.enabled
      ? '{"version":3,"sources":[],"names":[],"mappings":""}'
      : undefined;
    if ((options.mapAuto && !map) || options.map === false) {
      css = css.replace(/\\n*\\/\\*# SOURCEMAPPINGURL=[\\s\\S]*?\\*\\//g, '');
    }
    if (state.inline && map) {
      const encoded = Buffer.from(map).toString('base64');
      css += '\\n/*# sourceMappingURL=data:application/json;base64,' + encoded + ' */';
      map = undefined;
    } else if (!options.mapAnnotationDisabled && map) {
      const mapFile = options.mapFile ?? (options.to ?? options.from ?? 'to.css') + '.map';
      const annotation = options.mapAnnotation ?? mapFile.split(/[\\\\/]/).pop();
      css += '\\n/*# sourceMappingURL=' + annotation + ' */';
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        css,
        map,
        root: root(request.params.css, request.params.options),
        messages: [{ type: 'warning', text: 'processed' }],
      },
    }) + '\\n');
    return;
  }

  if (request.method === 'noWork') {
    const options = request.params.options ?? {};
    const state = mapState(request.params.css, options);
    let css = request.params.css.replace(/\\n*\\/\\*# sourceMappingURL=[\\s\\S]*?\\*\\//g, '');
    let map = state.enabled
      ? '{"version":3,"sources":[],"names":[],"mappings":""}'
      : undefined;
    if (state.inline && map) {
      const encoded = Buffer.from(map).toString('base64');
      css += '\\n/*# sourceMappingURL=data:application/json;base64,' + encoded + ' */';
      map = undefined;
    } else if (!options.mapAnnotationDisabled && map) {
      const mapFile = options.mapFile ?? (options.to ?? options.from ?? 'to.css') + '.map';
      const annotation = options.mapAnnotation ?? mapFile.split(/[\\\\/]/).pop();
      css += '\\n/*# sourceMappingURL=' + annotation + ' */';
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { css, map },
    }) + '\\n');
    return;
  }

  if (request.method === 'stringify') {
    const map = request.params.options?.map
      ? '{"version":3,"sources":["input.css"],"names":[],"mappings":"AAAA"}'
      : undefined;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { css: '.from-ast { color: blue; }', map },
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
  expect(processed.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(processed.map).toBeUndefined();
  expect(processed.messages).toEqual([{ type: 'warning', text: 'processed' }]);

  const css = await service.stringify({ type: 'root', nodes: [] });
  expect(css).toBe('.from-ast { color: blue; }');

  const stringified = await service.stringifyResult(
    { type: 'root', nodes: [] },
    { from: 'input.css', map: { inline: false } },
  );
  expect(stringified.css).toBe('.from-ast { color: blue; }');
  expect(stringified.map).toContain('"version":3');

  await service.close();
});

test('NodePostcssGoService supports object source map options', async () => {
  const service = await createService();
  const defaultInline = await service.process('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: {},
  });
  expect(defaultInline.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(defaultInline.map).toBeUndefined();

  const annotationTrue = await service.process('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: { annotation: true },
  });
  expect(annotationTrue.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(annotationTrue.map).toBeUndefined();

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

  const noWorkAnnotated = await service.noWork('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: {
      annotation(file, root) {
        expect(file).toBe('output.css');
        expect(root.type).toBe('root');
        return 'maps/no-work.map';
      },
      inline: false,
    },
  });
  expect(noWorkAnnotated.css).toContain('sourceMappingURL=maps/no-work.map');
  expect(noWorkAnnotated.map).toContain('"version":3');

  await service.close();
});

test('NodePostcssGoService infers map mode from previous annotations', async () => {
  const service = await createService();
  const previousMap = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ['input.css'],
      names: [],
      mappings: 'AAAA',
    }),
  ).toString('base64');
  const inline = await service.process(
    `.a {}\n/*# sourceMappingURL=data:application/json;base64,${previousMap} */`,
    { from: 'input.css', to: 'output.css' },
  );
  expect(inline.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(inline.map).toBeUndefined();

  const external = await service.process('.a {}\n/*# sourceMappingURL=input.css.map */', {
    from: 'input.css',
    to: 'output.css',
  });
  expect(external.css).not.toContain('SOURCEMAPPINGURL');
  expect(external.map).toBeUndefined();

  const explicitMissing = await service.process('.a {}\n/*# sourceMappingURL=input.css.map */', {
    from: 'input.css',
    map: {},
    to: 'output.css',
  });
  expect(explicitMissing.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(explicitMissing.map).toBeUndefined();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'postcss-go-previous-map-'));
  try {
    await fs.writeFile(
      path.join(tempDir, 'input.css.map'),
      JSON.stringify({
        version: 3,
        sources: ['original.css'],
        names: [],
        mappings: 'AAAA',
      }),
    );
    const loadedExternal = await service.process('.a {}\n/*# sourceMappingURL=input.css.map */', {
      from: path.join(tempDir, 'input.css'),
      map: {},
      to: path.join(tempDir, 'output.css'),
    });
    expect(loadedExternal.css).toContain('sourceMappingURL=output.css.map');
    expect(loadedExternal.map).toContain('"version":3');
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }

  await service.close();
});

test('NodePostcssGoService preserves pre-normalized external map controls', async () => {
  const service = await createService();
  const result = await service.process('.a { color: red; }', {
    from: 'input.css',
    to: 'output.css',
    map: true,
    mapAnnotation: 'output.css.map',
    mapAnnotationDisabled: false,
  });

  expect(result.css).toContain('sourceMappingURL=output.css.map');
  expect(result.map).toContain('"version":3');

  await service.close();
});

test('NodePostcssGoService keeps explicit map false disabled', async () => {
  const service = await createService();
  const processed = await service.process('.a {}\n/*# sourceMappingURL=input.css.map */', {
    from: 'input.css',
    map: false,
  });
  expect(processed.css).toBe('.A {}');
  expect(processed.map).toBeUndefined();

  const result = await service.noWork('.a {}\n/*# sourceMappingURL=input.css.map */', {
    from: 'input.css',
    map: false,
  });

  expect(result.css).toBe('.a {}');
  expect(result.map).toBeUndefined();
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
