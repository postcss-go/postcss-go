import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js';

import { afterEach, expect, test } from 'vitest';

import postcss, {
  AsyncPluginError,
  CssSyntaxError,
  Input,
  InvalidPluginError,
  PreviousMap,
  Processor,
  Result,
  ResultMap,
  Root,
  SyncBackendUnavailableError,
  UnknownPluginEventError,
  UnsupportedPluginFeatureError,
  UnsupportedSyntaxError,
  Warning,
  getBackendCapabilities,
  list,
  noWork,
  noWorkSync,
  parse,
  parseAst,
  parseSync,
  process,
  processSync,
  setPreviousMapFileLoader,
  stringify,
  stringifyAst,
  stringifySync,
  toResult,
} from '../src/index.ts';
import { dispatchProcess } from '../src/dispatch.ts';
import { installNativeSyncCssRuntime } from '../src/native.ts';

afterEach(() => {
  setPreviousMapFileLoader((file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  });
});

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

test('Node compatibility parse, string insertion, and default stringify require the Go runtime', () => {
  const previous = globalThis.process.env.POSTCSS_GO_DISABLE_NATIVE;
  globalThis.process.env.POSTCSS_GO_DISABLE_NATIVE = '1';
  try {
    installNativeSyncCssRuntime();
    expect(() => postcss.parse('.a{}')).toThrow(SyncBackendUnavailableError);
    expect(() => new Root().append('.a{}')).toThrow(SyncBackendUnavailableError);
    expect(() => new Root().toString()).toThrow(SyncBackendUnavailableError);
  } finally {
    if (previous === undefined) delete globalThis.process.env.POSTCSS_GO_DISABLE_NATIVE;
    else globalThis.process.env.POSTCSS_GO_DISABLE_NATIVE = previous;
    installNativeSyncCssRuntime();
  }
});

test('Node builder adapter replays Go chunks with live node identities', () => {
  const css = '.a { color: red; }';
  const root = postcss.parse(css);
  const chunks: string[] = [];
  const boundaries: Array<{ node?: unknown; type?: string }> = [];

  postcss.stringify(root, (chunk, node, type) => {
    chunks.push(chunk);
    if (type) boundaries.push({ node, type });
  });

  expect(chunks.join('')).toBe(css);
  expect(boundaries).toContainEqual({ node: root.first, type: 'start' });
  expect(boundaries).toContainEqual({ node: root.first, type: 'end' });
});

test('postcss.plugin creates named plugin creators', async () => {
  const createBlue = postcss.plugin('set-blue', () => ({
    Declaration(decl) {
      decl.value = 'blue';
    },
  }));
  expect(createBlue.postcss).toBe(true);

  const result = await postcss([createBlue()]).process('.a{color:red}', { from: 'input.css' });
  expect(result.css).toContain('blue');
  expect(result.backend).toBe('native');
});

test('stringifyAst stringifies a live Root without an injected service', async () => {
  const root = await parse('.a { color: red }', { from: 'input.css' });
  await expect(stringifyAst(root)).resolves.toContain('color: red');
});

test('toResult stringifies without an injected service', async () => {
  const root = postcss.parse('.a{color:red}', { from: 'input.css' });
  const result = await toResult(root);
  expect(result.css).toContain('color:red');
  expect(result.root).toBe(root);
});

test('list helpers preserve escapes, quotes, and nested function commas', () => {
  expect(list.comma('a\\,b, "c,d", fn(1,2)')).toEqual(['a\\,b', '"c,d"', 'fn(1,2)']);
  expect(list.space("a\\ b 'c d'")).toEqual(['a\\ b', "'c d'"]);
});

test('standalone process accepts transformer functions and nested plugin packs', async () => {
  const transformed = await postcss([
    (root) => {
      root.walkDecls((decl) => {
        decl.value = 'blue';
      });
    },
  ]).process('.a{color:red}', { from: 'input.css' });
  expect(transformed.css).toContain('blue');

  const packed = await postcss([
    {
      plugins: [
        {
          postcssPlugin: 'nested',
          Declaration(decl) {
            decl.value = 'green';
          },
        },
      ],
    },
  ]).process('.a{color:red}', { from: 'input.css' });
  expect(packed.css).toContain('green');
});

test('plugin prepare failures and unknown visitor events surface clear errors', async () => {
  await expect(
    postcss([
      {
        postcssPlugin: 'bad-prepare',
        prepare() {
          throw Object.assign(new Error('boom'), { plugin: undefined });
        },
      },
    ]).process('.a{}', { from: 'input.css' }),
  ).rejects.toThrow(/boom/);

  await expect(
    postcss([
      {
        postcssPlugin: 'unknown-event',
        WeirdEvent() {},
      } as never,
    ]).process('.a{}', { from: 'input.css' }),
  ).rejects.toBeInstanceOf(UnknownPluginEventError);
});

test('Processor normalizes plugin packs and rejects invalid plugins eagerly', () => {
  const packed = postcss({
    plugins: [{ postcssPlugin: 'one' }, { postcssPlugin: 'two' }],
  });
  expect(packed.plugins).toHaveLength(2);
  expect(() => postcss().use(null as never)).toThrow(InvalidPluginError);
});

test('syntax objects used as plugins throw a stable unsupported-feature error', () => {
  const syntax = {
    parse() {
      return new Root();
    },
    stringify() {},
  };
  expect(() => postcss().use(syntax as never)).toThrow(UnsupportedPluginFeatureError);
  expect(() => postcss().use(syntax as never)).toThrow(/cannot be used as plugins/);
});

test('explicit async parse and stringify use live postcss-go nodes', async () => {
  const root = await parse('.a { color: red }', { from: 'input.css' });
  expect(root).toBeInstanceOf(Root);
  expect(root.source?.input).toBeInstanceOf(Input);
  expect(await stringify(root)).toContain('color: red');
});

test('bare parse APIs attach PreviousMap metadata', async () => {
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

  // Plugin path narrows options before the service; must still reject.
  const plugin = { postcssPlugin: 'noop' };
  await expect(postcss([plugin]).process('.a{}', { parser })).rejects.toBeInstanceOf(
    UnsupportedSyntaxError,
  );
  expect(() => postcss([plugin]).processSync('.a{}', { parser })).toThrow(UnsupportedSyntaxError);
});

test('Processor and dispatchProcess share the same unsupported-syntax gate', async () => {
  const parser = () => postcss.root();
  const service = {
    process: async () => {
      throw new Error('should not reach service');
    },
    parse: async () => {
      throw new Error('should not reach service');
    },
    noWork: async () => {
      throw new Error('should not reach service');
    },
    stringify: async () => '',
    stringifyResult: async () => ({ css: '' }),
    close: async () => undefined,
    capabilities: {
      backend: 'native' as const,
      asynchronous: true as const,
      backendWorkOffMainThread: true as const,
      synchronous: true as const,
    },
  };

  await expect(dispatchProcess(service, '.a{}', { parser }, [])).rejects.toBeInstanceOf(
    UnsupportedSyntaxError,
  );
  await expect(postcss().process('.a{}', { parser })).rejects.toBeInstanceOf(
    UnsupportedSyntaxError,
  );
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

test('no-plugin annotation mutates and receives the process result root', async () => {
  let asyncRoot: Root | undefined;
  const asyncResult = await postcss().process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: {
      inline: false,
      annotation(_file, root) {
        asyncRoot = root as Root;
        root.append({ prop: 'color', value: 'blue' });
        return 'async.css.map';
      },
    },
  });
  expect(asyncResult.root).toBe(asyncRoot);
  expect(asyncResult.css).toContain('color: blue');

  let syncRoot: Root | undefined;
  const syncResult = postcss().processSync('.b{}', {
    from: 'input.css',
    to: 'output.css',
    map: {
      inline: false,
      annotation(_file, root) {
        syncRoot = root as Root;
        root.append({ prop: 'display', value: 'block' });
        return 'sync.css.map';
      },
    },
  });
  expect(syncResult.root).toBe(syncRoot);
  expect(syncResult.css).toContain('display: block');
});

test('no-work annotation does not force a temporary parse', async () => {
  const roots: unknown[] = [];
  const options = {
    from: 'input.css',
    to: 'output.css',
    map: {
      inline: false,
      annotation(_file: string | undefined, root: unknown) {
        roots.push(root);
        return 'output.css.map';
      },
    },
  };

  expect(noWorkSync('.a{}', options).css).toContain('sourceMappingURL=output.css.map');
  await expect(noWork('.b{}', options)).resolves.toMatchObject({
    css: expect.stringContaining('sourceMappingURL=output.css.map'),
  });
  expect(roots).toEqual([undefined, undefined]);
});

test('plugin helpers expose both flattened API members and helpers.postcss', async () => {
  expect(postcss.Result).toBe(Result);
  expect(postcss.Warning).toBe(Warning);
  expect(postcss.Input).toBe(Input);
  expect(postcss.CssSyntaxError).toBe(CssSyntaxError);
  expect(() => postcss.parse('a { color: red')).toThrow(CssSyntaxError);

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
  const previousMap = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ['original.css'],
      names: [],
      mappings: 'AAAA',
      sourcesContent: ['.a{}'],
    }),
  ).toString('base64');
  const css = `.a{}\n/*# sourceMappingURL=data:application/json;base64,${previousMap} */`;
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
  expect(
    stringifySync(root, {
      from: 'input.css',
      to: 'output.css',
      map: { inline: false, annotation: 'maps/custom.map' },
    }),
  ).toContain('sourceMappingURL=maps/custom.map');
  expect(
    stringifySync(root, {
      from: 'input.css',
      to: 'output.css',
      map: { inline: false, annotation: false },
    }),
  ).not.toContain('sourceMappingURL');
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

test('plugins parse and insert CSS strings through the native backend', async () => {
  const plugin = {
    postcssPlugin: 'insert-css',
    Once(root: Root, helpers: { postcss: typeof postcss }) {
      root.append('.b{color:green}');
      expect(helpers.postcss.parse('.c{display:block}').first).toBeInstanceOf(postcss.Rule);
      expect(root.first?.toString()).toContain('color:red');
    },
  };

  const asyncResult = await postcss([plugin]).process('.a{color:red}', { from: 'input.css' });
  expect(asyncResult.css).toContain('.a{color:red}');
  expect(asyncResult.css).toContain('.b{color:green}');

  const syncResult = processSync('.a{color:red}', { from: 'input.css' }, [plugin]);
  expect(syncResult.css).toContain('.b{color:green}');
});

test('explicit sync APIs use the native backend', () => {
  const css = '@media screen { .a { color: red; --value: fn(a; b) } }';
  const root = parseSync(css, { from: 'input.css' });
  expect(root).toBeInstanceOf(Root);
  expect(root.toString()).toBe(css);
  expect(root.first?.source?.input).toBeInstanceOf(Input);
  expect(stringifySync(root)).toBe(css);

  let built = '';
  stringifySync(root, (chunk) => {
    built += chunk;
  });
  expect(built).toBe(css);
  expect(processSync('.a{}').css).toBe('.a{}');
  expect(noWorkSync('.a{}').css).toBe('.a{}');
});

test('backend capabilities describe default async and optional sync execution', () => {
  expect(getBackendCapabilities()).toEqual({
    asynchronous: expect.objectContaining({
      backend: 'native',
      backendWorkOffMainThread: true,
      synchronous: true,
    }),
    synchronous: expect.objectContaining({ backend: 'native', synchronous: true }),
  });
});

test('default APIs report stable unavailable errors when native is disabled', () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import {
      AsyncBackendUnavailableError,
      Root,
      getBackendCapabilities,
      noWorkSync,
      parse,
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
    let asyncError = null;
    try {
      await parse('.a{}');
    } catch (error) {
      asyncError = error.name;
    }
    process.stdout.write(JSON.stringify({
      asyncError,
      asyncErrorMatchesExport: asyncError === AsyncBackendUnavailableError.name,
      errors,
      asynchronous: getBackendCapabilities().asynchronous,
      synchronous: getBackendCapabilities().synchronous
    }));
  `;
  const child = spawnSync(globalThis.process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...globalThis.process.env, POSTCSS_GO_DISABLE_NATIVE: '1' },
  });

  expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    asyncError: 'AsyncBackendUnavailableError',
    asyncErrorMatchesExport: true,
    errors: Array(4).fill(SyncBackendUnavailableError.name),
    asynchronous: null,
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

test('parseAst returns a serializable AST DTO', async () => {
  const root = await parseAst('.a { color: red }', { from: 'input.css' });
  expect(root).toMatchObject({ type: 'root' });
  expect(root).not.toBeInstanceOf(Root);
  expect(typeof (root as { walk?: unknown }).walk).toBe('undefined');
});

test('Processor surfaces Go mapFile for external maps', async () => {
  const result = await postcss().process('.a{}', {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false, annotation: 'maps/out.css.map' },
  });
  expect(result.mapFile).toBeTruthy();
  expect(result.mapFile).toMatch(/out\.css\.map$/);
  expect(result.css).toContain('sourceMappingURL=maps/out.css.map');
});

test('materializePreviousMap rejects async map.prev at the public boundary', async () => {
  await expect(
    postcss().process('.a{}', {
      map: { prev: async () => ({ version: 3 }) },
    }),
  ).rejects.toThrow(/map\.prev returned a Promise/);
});

test('map.annotation receives a live Root with and without plugins', async () => {
  const shapes: Array<{ walk: string; name: string }> = [];
  const annotation = (
    _to: string | undefined,
    root: { walk?: unknown; constructor?: { name?: string } },
  ) => {
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
  expect(
    processSync('.a{}', { map: { annotation, inline: false }, from: 'a.css', to: 'b.css' }).css,
  ).toContain('sourceMappingURL=x.css.map');

  expect(shapes).toEqual([
    { walk: 'function', name: 'Root' },
    { walk: 'function', name: 'Root' },
    { walk: 'function', name: 'Root' },
  ]);
});

test('plugin bridge accepts Document roots from the service parse path', async () => {
  let sawDocument = false;
  const service = {
    capabilities: {
      backend: 'wasm-worker' as const,
      asynchronous: true,
      backendWorkOffMainThread: true,
      synchronous: false,
    },
    async parse() {
      return {
        root: {
          type: 'document' as const,
          nodes: [
            {
              type: 'root' as const,
              nodes: [{ type: 'rule' as const, selector: '.a', nodes: [] }],
            },
          ],
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

test('Once and OnceExit run once for every Root inside a Document', async () => {
  const calls: string[] = [];
  const service = {
    capabilities: {
      backend: 'wasm-worker' as const,
      asynchronous: true,
      backendWorkOffMainThread: true,
      synchronous: false,
    },
    async parse() {
      return {
        root: {
          type: 'document' as const,
          nodes: [
            {
              type: 'root' as const,
              nodes: [{ type: 'rule' as const, selector: '.a', nodes: [] }],
            },
            {
              type: 'root' as const,
              nodes: [{ type: 'rule' as const, selector: '.b', nodes: [] }],
            },
          ],
        },
      };
    },
    async stringifyResult() {
      return { css: '.a{}.b{}' };
    },
    async close() {},
  };

  await postcss({
    postcssPlugin: 'document-once',
    Once(root) {
      calls.push(`once:${root.first?.type}`);
    },
    OnceExit(root) {
      calls.push(`exit:${root.first?.type}`);
    },
  }).process('', {}, { service: service as never });

  expect(calls).toEqual(['once:rule', 'once:rule', 'exit:rule', 'exit:rule']);
});

test('ResultMap.toJSON wraps invalid JSON with a stable error', () => {
  const map = new ResultMap('{not-json');
  expect(() => map.toJSON()).toThrow(/not valid JSON/);
});

test('ResultMap exposes SourceMapGenerator mutation methods', () => {
  const map = new ResultMap(JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }));
  map.addMapping({
    generated: { line: 1, column: 0 },
    original: { line: 1, column: 0 },
    source: 'input.css',
  });
  map.setSourceContent('input.css', '.a{}');
  expect(map.toJSON()).toMatchObject({
    sources: ['input.css'],
    sourcesContent: ['.a{}'],
  });

  const consumer = new SourceMapConsumer({
    version: 3,
    sources: ['nested.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.nested{}'],
  });
  map.applySourceMap(consumer, 'input.css');
  expect(map.toString()).toContain('version');
});

test('Result.warn picks up lastPlugin and messages stay as Warning instances', () => {
  const result = new Result({ plugins: [] }, new Root());
  result.lastPlugin = { postcssPlugin: 'from-last-plugin' };
  const warning = result.warn('watch out');
  expect(warning.plugin).toBe('from-last-plugin');
  expect(result.warnings()).toEqual([warning]);

  result.lastPlugin = 'not-an-object' as never;
  expect(result.warn('again', { plugin: 'explicit' }).plugin).toBe('explicit');
  expect(result.warn('no-plugin').plugin).toBeUndefined();
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

test('PreviousMap accepts generator, function, and stringifiable map.prev values', () => {
  const raw = {
    version: 3,
    sources: ['a.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.a{}'],
  };
  const consumer = new SourceMapConsumer(raw);
  const generator = SourceMapGenerator.fromSourceMap(consumer);

  expect(new PreviousMap('.a{}', { from: 'a.css', map: { prev: generator } }).text).toContain(
    '"version":3',
  );
  expect(new PreviousMap('.a{}', { from: 'a.css', map: { prev: () => raw } }).text).toContain(
    '"version":3',
  );
  expect(
    new PreviousMap('.a{}', {
      from: 'a.css',
      map: {
        prev: {
          toString() {
            return JSON.stringify(raw);
          },
        },
      },
    }).text,
  ).toContain('"version":3');
});

test('PreviousMap loads external annotations and rejects unsupported encodings', () => {
  const raw = {
    version: 3,
    sources: ['a.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.a{}'],
  };

  setPreviousMapFileLoader(() => `${JSON.stringify(raw)}\n`);
  const fromFile = new PreviousMap('.a{}\n/*# sourceMappingURL=out.css.map */', {
    from: '/tmp/a.css',
  });
  expect(fromFile.text).toContain('"version":3');
  expect(fromFile.mapFile).toMatch(/out\.css\.map$/);

  setPreviousMapFileLoader(() => 'not-json');
  expect(
    new PreviousMap('.a{}\n/*# sourceMappingURL=broken.css.map */', { from: '/tmp/a.css' }).text,
  ).toBeUndefined();

  const uriEncoded = encodeURIComponent(JSON.stringify(raw));
  const uriMap = new PreviousMap(
    `.a{}\n/*# sourceMappingURL=data:application/json,${uriEncoded} */`,
  );
  expect(uriMap.inline).toBe(true);
  expect(uriMap.toJSON()?.version).toBe(3);

  expect(
    () => new PreviousMap('.a{}\n/*# sourceMappingURL=data:text/plain;base64,YQ== */'),
  ).toThrow(/Unsupported source map encoding/);

  const broken = new PreviousMap('.a{}', { map: { prev: '{not-json' } });
  expect(broken.toJSON()).toBeUndefined();
  expect(broken.withContent()).toBe(false);
  expect(broken.toString()).toBe('{not-json');

  const empty = new PreviousMap('.a{}', { map: false });
  expect(empty.toString()).toBe('');
  expect(() => empty.consumer()).toThrow(/not available/);
});

test('map.prev accepts SourceMapConsumer and SourceMapGenerator on public backend paths', async () => {
  const rawMap = {
    version: 3,
    sources: ['original.css'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['.a{}'],
  };
  const consumer = new SourceMapConsumer(rawMap);
  const generator = SourceMapGenerator.fromSourceMap(consumer);
  const options = {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false, annotation: false },
  };

  await expect(
    process('.a{}', { ...options, map: { ...options.map, prev: consumer } }),
  ).resolves.toMatchObject({ map: expect.any(String) });
  await expect(
    noWork('.a{}', { ...options, map: { ...options.map, prev: generator } }),
  ).resolves.toMatchObject({ map: expect.any(String) });
  await expect(
    stringify(postcss.parse('.a{}', { from: 'input.css' }), {
      ...options,
      map: { ...options.map, prev: consumer },
    }),
  ).resolves.toContain('.a{}');
});
