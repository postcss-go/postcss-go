import { spawnSync } from 'node:child_process';

import { expect, test } from 'vitest';

import postcss, {
  AsyncPluginError,
  Input,
  PreviousMap,
  Processor,
  Result,
  ResultMap,
  Root,
  SyncBackendUnavailableError,
  UnsupportedSyntaxError,
  getBackendCapabilities,
  noWorkSync,
  parse,
  parseSync,
  process,
  processSync,
  stringify,
  stringifySync,
} from '../src/index.ts';

test('default entry point creates a reusable Processor', () => {
  const processor = postcss();
  expect(processor).toBeInstanceOf(Processor);
  expect(processor.use({ postcssPlugin: 'noop' })).toBe(processor);
  expect(postcss.Root).toBe(Root);
  expect(postcss.Processor).toBe(Processor);
  expect(postcss.default).toBe(postcss);
  expect(postcss.parse('.a{}')).toBeInstanceOf(Root);
  expect(postcss({ postcssPlugin: 'one' }, { postcssPlugin: 'two' }).plugins).toHaveLength(2);
});

test('explicit async parse and stringify use live postcss-go nodes', async () => {
  const root = await parse('.a { color: red }', { from: 'input.css' });
  expect(root).toBeInstanceOf(Root);
  expect(root.source?.input).toBeInstanceOf(Input);
  expect(await stringify(root)).toContain('color: red');
});

test('bare parse APIs attach PreviousMap metadata', async () => {
  const css = '.a{}\n/*# sourceMappingURL=input.css.map */';
  const asyncRoot = await parse(css, { from: 'input.css' });
  const syncRoot = parseSync(css, { from: 'input.css' });

  expect(asyncRoot.source?.input?.map).toBeInstanceOf(PreviousMap);
  expect(syncRoot.source?.input?.map).toBeInstanceOf(PreviousMap);
});

test('map false prevents PreviousMap metadata on bare parse APIs', async () => {
  const previous = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ['input.css'],
      names: [],
      mappings: '',
      sourcesContent: ['.a{}'],
    }),
  ).toString('base64');
  const css = `.a{}\n/*# sourceMappingURL=data:application/json;base64,${previous} */`;

  expect((await parse(css, { from: 'input.css', map: false })).source?.input?.map).toBeUndefined();
  expect(parseSync(css, { from: 'input.css', map: false }).source?.input?.map).toBeUndefined();
});

test('Processor process runs plugins and returns an owned Result', async () => {
  const processor = postcss([
    {
      postcssPlugin: 'blue',
      Declaration(decl) {
        decl.value = 'blue';
      },
    },
  ]);
  const result = await processor.process('.a { color: red }', { from: 'input.css' });

  expect(result).toBeInstanceOf(Result);
  expect(result.root).toBeInstanceOf(Root);
  expect(result.processor).toBe(processor);
  expect(result.css).toContain('color: blue');
});

test('public backend APIs reject unsupported syntax instead of silently ignoring it', async () => {
  const parser = () => postcss.root();
  const stringifier = () => undefined;

  expect(() => parseSync('.a{}', { parser })).toThrow(UnsupportedSyntaxError);
  await expect(parse('.a{}', { parser })).rejects.toBeInstanceOf(UnsupportedSyntaxError);
  await expect(process('.a{}', { parser })).rejects.toBeInstanceOf(UnsupportedSyntaxError);

  const root = postcss.parse('.a{}');
  expect(() => stringifySync(root, { stringifier })).toThrow(UnsupportedSyntaxError);
  await expect(stringify(root, { stringifier })).rejects.toBeInstanceOf(UnsupportedSyntaxError);
});

test('named custom syntax functions cannot masquerade as default delegates', async () => {
  function parser(css: string) {
    return postcss.parse(css);
  }
  Object.defineProperty(parser, 'name', { value: 'parse' });

  expect(() => parseSync('.a{}', { parser })).toThrow(UnsupportedSyntaxError);
  await expect(parse('.a{}', { parser })).rejects.toBeInstanceOf(UnsupportedSyntaxError);
  await expect(process('.a{}', { parser })).rejects.toBeInstanceOf(UnsupportedSyntaxError);
});

test('async processing awaits map annotations while sync processing rejects thenables', async () => {
  const annotation = async () => 'custom.css.map';
  const asyncResult = await postcss().process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { annotation, inline: false },
  });
  expect(asyncResult.css).toContain('sourceMappingURL=custom.css.map');

  await expect(
    postcss({ postcssPlugin: 'noop' }).process('.a{}', {
      from: 'input.css',
      to: 'output.css',
      map: { annotation, inline: false },
    }),
  ).resolves.toMatchObject({ css: expect.stringContaining('sourceMappingURL=custom.css.map') });

  expect(() =>
    postcss().processSync('.a{}', {
      map: { annotation, inline: false },
    }),
  ).toThrow(AsyncPluginError);
});

test('plugin helpers expose both flattened API members and helpers.postcss', async () => {
  await postcss({
    postcssPlugin: 'helpers-contract',
    Rule(_rule, helpers) {
      expect(helpers.Root).toBe(Root);
      expect(helpers.list).toBe(postcss.list);
      expect(helpers.postcss).toBe(postcss);
    },
  }).process('.a{}');
});

test('previous maps preserve the shared Input instance across the tree', async () => {
  const css = '.a{}\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ== */';
  await postcss({
    postcssPlugin: 'input-contract',
    Once(root) {
      expect(root.source?.input).toBeInstanceOf(Input);
      expect(root.source?.input).toBe(root.first?.source?.input);
      expect(typeof root.source?.input?.error).toBe('function');
      expect(root.source?.input?.map).toBeInstanceOf(PreviousMap);
    },
  }).process(css);
});

test('Result map exposes source-map methods', async () => {
  const result = await postcss().process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false },
  });
  expect(result.map?.toJSON().version).toBe(3);
  expect(result.map?.toString()).toContain('"version":3');
});

test('plugin processing finalizes inline and external source maps', async () => {
  const processor = postcss({ postcssPlugin: 'source-map-noop' });

  const external = await processor.process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false },
  });
  expect(external.css).toContain('sourceMappingURL=output.css.map');
  expect(external.map?.toJSON().version).toBe(3);

  const inline = await processor.process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: true,
  });
  expect(inline.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(inline.map).toBeUndefined();

  const disabledAnnotation = await processor.process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { annotation: false, inline: false },
  });
  expect(disabledAnnotation.css).not.toContain('sourceMappingURL=');
  expect(disabledAnnotation.map).toBeDefined();

  const withoutMap = await processor.process('.a{}', {
    from: 'input.css',
  });
  expect(withoutMap.css).not.toContain('sourceMappingURL=');
  expect(withoutMap.map).toBeUndefined();

  const syncExternal = processor.processSync('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false },
  });
  expect(syncExternal.css).toContain('sourceMappingURL=output.css.map');
  expect(syncExternal.map).toBeDefined();

  const syncInline = processor.processSync('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: true,
  });
  expect(syncInline.css).toContain('sourceMappingURL=data:application/json;base64,');
  expect(syncInline.map).toBeUndefined();
});

test('standalone stringify finalizes map annotations', async () => {
  const root = postcss.parse('.a{}', { from: 'input.css' });
  await expect(
    stringify(root, {
      from: 'input.css',
      to: 'output.css',
      map: { inline: false },
    }),
  ).resolves.toContain('sourceMappingURL=output.css.map');
});

test('Once and OnceExit receive the same root stored on Result', async () => {
  const identities: boolean[] = [];
  await postcss({
    postcssPlugin: 'root-identity',
    Once(root, { result }) {
      identities.push(root === result.root);
    },
    OnceExit(root, { result }) {
      identities.push(root === result.root);
    },
  }).process('.a{}');
  expect(identities).toEqual([true, true]);
});

test('explicit sync APIs use the native backend', () => {
  const root = parseSync('.a { color: red }', { from: 'input.css' });
  expect(root).toBeInstanceOf(Root);
  expect(stringifySync(root)).toContain('color: red');
  expect(processSync('.a{}').css).toBe('.a{}');
  expect(noWorkSync('.a{}').css).toBe('.a{}');
});

test('backend capabilities describe default async and optional sync execution', () => {
  expect(getBackendCapabilities()).toEqual({
    asynchronous: expect.objectContaining({ backend: 'stdio', synchronous: false }),
    synchronous: expect.objectContaining({ backend: 'native', synchronous: true }),
  });
});

test('sync APIs throw SyncBackendUnavailableError when native is disabled', () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import {
      Root,
      getBackendCapabilities,
      noWorkSync,
      parseSync,
      processSync,
      stringifySync
    } from ${JSON.stringify(entry)};
    const operations = [
      () => parseSync('.a{}'),
      () => processSync('.a{}'),
      () => stringifySync(new Root()),
      () => noWorkSync('.a{}')
    ];
    const errors = operations.map(operation => {
      try {
        operation();
        return null;
      } catch (error) {
        return error.name;
      }
    });
    process.stdout.write(JSON.stringify({
      errors,
      synchronous: getBackendCapabilities().synchronous
    }));
  `;
  const child = spawnSync(globalThis.process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...globalThis.process.env, POSTCSS_GO_DISABLE_NATIVE: '1' },
  });

  expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    errors: Array(4).fill(SyncBackendUnavailableError.name),
    synchronous: null,
  });
});

test('processSync rejects thenables from every plugin lifecycle phase', () => {
  const creator = Object.assign(async () => ({ postcssPlugin: 'creator' }), { postcss: true });
  expect(() => processSync('.a{}', {}, [creator])).toThrow(AsyncPluginError);

  expect(() =>
    processSync('.a{}', {}, [
      {
        postcssPlugin: 'prepare',
        async prepare() {
          return {};
        },
      },
    ]),
  ).toThrow(AsyncPluginError);

  expect(() =>
    processSync('.a{}', {}, [
      {
        postcssPlugin: 'visitor',
        async Rule() {},
      },
    ]),
  ).toThrow(AsyncPluginError);

  for (const lifecycle of ['Once', 'OnceExit'] as const) {
    expect(() =>
      processSync('.a{}', {}, [
        {
          postcssPlugin: lifecycle.toLowerCase(),
          async [lifecycle]() {},
        },
      ]),
    ).toThrow(AsyncPluginError);
  }
});

test('processSync observes rejected thenables before throwing', async () => {
  let rejectionHandlerAttached = false;
  const thenable = {
    then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      rejectionHandlerAttached = typeof reject === 'function';
      reject(new Error('late rejection'));
    },
  };

  expect(() =>
    processSync('.a{}', {}, [
      {
        postcssPlugin: 'rejected-thenable',
        Rule() {
          return thenable;
        },
      },
    ]),
  ).toThrow(AsyncPluginError);

  await Promise.resolve();
  expect(rejectionHandlerAttached).toBe(true);
});

test('unwraps { postcss: creator } wrappers before invoking creators', async () => {
  let ran = false;
  const creator = Object.assign(
    () => ({
      postcssPlugin: 'wrapped',
      Once() {
        ran = true;
      },
    }),
    { postcss: true as const },
  );

  await postcss(creator).process('.a{}');
  expect(ran).toBe(true);

  ran = false;
  await postcss({ postcss: creator }).process('.a{}');
  expect(ran).toBe(true);

  ran = false;
  processSync('.a{}', {}, [{ postcss: creator }]);
  expect(ran).toBe(true);
});

test('standalone process hydrates a live Root with Input metadata', async () => {
  const processed = await process('.a{color:red}', { from: 'input.css' });
  expect(processed.root).toBeInstanceOf(Root);
  expect(processed.root.source?.input).toBeInstanceOf(Input);
  expect(typeof processed.root.walkDecls).toBe('function');
});

test('map.annotation receives a live Root with and without plugins', async () => {
  const shapes: Array<{ walk: string; name: string }> = [];
  const annotation = (_to: string | undefined, root: { walk?: unknown; constructor?: { name?: string } }) => {
    shapes.push({
      walk: typeof root.walk,
      name: root.constructor?.name ?? 'plain',
    });
    return 'x.css.map';
  };

  await postcss().process('.a{}', {
    from: 'a.css',
    to: 'b.css',
    map: { annotation, inline: false },
  });
  await postcss({ postcssPlugin: 'noop' }).process('.a{}', {
    from: 'a.css',
    to: 'b.css',
    map: { annotation, inline: false },
  });
  expect(processSync('.a{}', { map: { annotation, inline: false }, from: 'a.css', to: 'b.css' }).css).toContain(
    'sourceMappingURL=x.css.map',
  );

  expect(shapes).toEqual([
    { walk: 'function', name: 'Root' },
    { walk: 'function', name: 'Root' },
    { walk: 'function', name: 'Root' },
  ]);
});

test('plugin bridge accepts Document roots from the service parse path', async () => {
  let sawDocument = false;
  const service = {
    capabilities: { backend: 'stdio' as const, synchronous: false, sourceMaps: true, plugins: true },
    async parse() {
      return {
        root: {
          type: 'document' as const,
          nodes: [{ type: 'root' as const, nodes: [{ type: 'rule' as const, selector: '.a', nodes: [] }] }],
        },
      };
    },
    async stringifyResult() {
      return { css: '.a{}' };
    },
    async close() {},
  };

  const result = await postcss({
    postcssPlugin: 'document-visitor',
    Document() {
      sawDocument = true;
    },
  }).process('.a{}', {}, { service: service as never });

  expect(sawDocument).toBe(true);
  expect(result.root.type).toBe('document');
});

test('ResultMap.toJSON wraps invalid JSON with a stable error', () => {
  const map = new ResultMap('{not-json');
  expect(() => map.toJSON()).toThrow(/not valid JSON/);
});

test('PreviousMap exposes annotation, inline text, and source content', () => {
  const text = JSON.stringify({
    version: 3,
    sources: ['a.css'],
    sourcesContent: ['.a{}'],
    names: [],
    mappings: 'AAAA',
  });
  const css = `.a{}\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(text).toString('base64')} */`;
  const map = new PreviousMap(css, { from: 'a.css' });
  expect(map.inline).toBe(true);
  expect(map.withContent()).toBe(true);
  expect(map.toJSON()?.version).toBe(3);
});
