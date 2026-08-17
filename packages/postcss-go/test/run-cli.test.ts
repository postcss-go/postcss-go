import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';

import chokidar from 'chokidar';

import { runCLI } from '../src/cli.ts';
import tmp from './helpers/tmp.ts';
import read from './helpers/read.ts';

const originalStdin = process.stdin;

afterEach(() => {
  vi.restoreAllMocks();
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  Object.defineProperty(process, 'stdin', {
    value: originalStdin,
    configurable: true,
    writable: true,
  });
});

function mockExit(throwOnExit = true) {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    if (throwOnExit) throw new Error(`process.exit:${code ?? 0}`);
    return undefined as never;
  }) as never);
}

async function writeCss(directory: string, name = 'in.css', css = 'a { color: red; }') {
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, name);
  await fs.writeFile(input, css);
  return input;
}

test('runCLI writes processed CSS to an output file', async () => {
  const exit = mockExit();
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  await runCLI([input, '-o', output, '--no-map']);

  expect(await read(output)).toContain('color: red');
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI prints backend details in verbose mode', async () => {
  const exit = mockExit();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  await runCLI([input, '-o', output, '--no-map', '--verbose']);

  const messages = warn.mock.calls.map((call) => String(call[0])).join('\n');
  expect(messages).toContain('Backend: native (native addon available)');
  expect(messages).toMatch(/Backend: native\b/);
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI --help returns without creating work', async () => {
  const exit = mockExit();
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  await runCLI(['--help']);

  expect(write.mock.calls.flat().join('')).toMatch(/Usage:/);
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI loads --use plugins exported as objects', async () => {
  const exit = mockExit();
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  await runCLI([
    input,
    '-o',
    output,
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-teal.mjs'),
  ]);

  expect(await read(output)).toContain('color: teal');
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI loads --use plugin creators and reports missing plugins', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  await runCLI([
    input,
    '-o',
    output,
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);
  expect(await read(output)).toContain('color: blue');

  await expect(
    runCLI([input, '-o', output, '--no-map', '-u', 'definitely-missing-postcss-plugin']),
  ).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/Plugin Error/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI rejects a missing explicit --config path', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  await fs.writeFile(path.join(directory, 'postcss.config.mjs'), 'export default { map: false };');

  await expect(
    runCLI([input, '--no-map', '--config', path.join(directory, 'missing.config.mjs')]),
  ).rejects.toThrow(/process\.exit:1/);

  expect(error.mock.calls.flat().join('\n')).toMatch(/Config Error: Could not find a config file/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI watch startup failures shut down with exit code 1', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);

  await expect(runCLI([input, '--watch', '--no-map'])).rejects.toThrow(/process\.exit:1/);

  expect(error.mock.calls.flat().join('\n')).toMatch(/Cannot write to stdout in watch mode/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI --replace, --dir/--ext/--base, and --map cover output modes', async () => {
  const exit = mockExit();
  const directory = tmp();
  const replaceFile = path.join(directory, 'replace.css');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(replaceFile, 'a { color: red; }');

  await runCLI([
    replaceFile,
    '--replace',
    '--no-map',
    '-u',
    path.resolve('test/fixtures/plugins/to-blue.mjs'),
  ]);
  expect(await read(replaceFile)).toContain('color: blue');

  const nested = path.join(directory, 'src', 'a.css');
  await fs.mkdir(path.dirname(nested), { recursive: true });
  await fs.writeFile(nested, 'a { color: red; }');
  const outDir = path.join(directory, 'dist');
  await runCLI([
    nested,
    '--dir',
    outDir,
    '--base',
    path.join(directory, 'src'),
    '--ext',
    'min.css',
    '--no-map',
  ]);
  expect(await read(path.join(outDir, 'a.min.css'))).toContain('color: red');

  const mapped = path.join(directory, 'mapped.css');
  await runCLI([nested, '-o', mapped, '--map']);
  expect(await fs.readFile(`${mapped}.map`, 'utf8')).toBeTruthy();
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI --env sets NODE_ENV for config loading', async () => {
  const exit = mockExit();
  const previous = process.env.NODE_ENV;
  const directory = path.resolve('test/fixtures/config');
  const output = path.join(tmp(), 'env-out.css');
  await fs.mkdir(path.dirname(output), { recursive: true });

  try {
    await runCLI([
      path.join(directory, 'input.css'),
      '-o',
      output,
      '--no-map',
      '--env',
      'production',
      '--config',
      directory,
    ]);
    expect(await read(output)).toContain('border-color: black');
    expect(process.env.NODE_ENV).toBe('production');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI rejects empty globs and multi-file runs without --dir/--replace', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  await fs.mkdir(directory, { recursive: true });

  await expect(runCLI([path.join(directory, '*.nomatch.css'), '--no-map'])).rejects.toThrow(
    /process\.exit:1/,
  );
  expect(error.mock.calls.flat().join('\n')).toMatch(/valid list of files/);

  const a = await writeCss(directory, 'a.css');
  const b = await writeCss(directory, 'b.css');
  await expect(runCLI([a, b, '--no-map'])).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/--dir or --replace/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI reads stdin and rejects empty stdin / stdin+dir', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const output = path.join(directory, 'stdin-out.css');
  await fs.mkdir(directory, { recursive: true });

  Object.defineProperty(process, 'stdin', {
    value: Readable.from(['a { color: red; }']),
    configurable: true,
  });
  await runCLI(['-o', output, '--no-map']);
  expect(await read(output)).toContain('color: red');

  Object.defineProperty(process, 'stdin', {
    value: Readable.from(['']),
    configurable: true,
  });
  await expect(runCLI(['--no-map'])).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/Did not receive any STDIN/);

  Object.defineProperty(process, 'stdin', {
    value: Readable.from(['a{}']),
    configurable: true,
  });
  await expect(runCLI(['--dir', directory, '--no-map'])).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/--dir or --replace when reading from stdin/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI rejects config from/to and external maps to stdout', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await expect(
    runCLI([
      path.resolve('test/fixtures/errors/input.css'),
      '--no-map',
      '--config',
      path.resolve('test/fixtures/errors'),
    ]),
  ).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/Can not set from or to options/);

  await expect(
    runCLI([
      path.resolve('test/fixtures/config-external-map/input.css'),
      '--config',
      path.resolve('test/fixtures/config-external-map'),
    ]),
  ).rejects.toThrow(/process\.exit:1/);
  expect(error.mock.calls.flat().join('\n')).toMatch(/external sourcemaps when writing to STDOUT/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI prints plugin warnings and skips unchanged outputs', async () => {
  const exit = mockExit();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');
  const plugin = path.resolve('test/fixtures/plugins/warn-and-deps.mjs');

  await runCLI([input, '-o', output, '--no-map', '-u', plugin]);
  expect(warn.mock.calls.flat().join('\n')).toMatch(/be careful/);

  const firstStat = await fs.stat(output);
  await runCLI([input, '-o', output, '--no-map', '-u', plugin]);
  const secondStat = await fs.stat(output);
  expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI rejects watch mode with stdin and string error formatting', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  Object.defineProperty(process, 'stdin', {
    value: Readable.from(['a { color: red; }']),
    configurable: true,
  });
  await expect(runCLI(['--watch', '--no-map', '-o', path.join(tmp(), 'x.css')])).rejects.toThrow(
    /process\.exit:1/,
  );
  expect(error.mock.calls.flat().join('\n')).toMatch(/watch mode when reading from stdin/);
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI formats unsupported parser diagnostics', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  // Unsupported custom parser still flows through the CLI error printer.
  await expect(
    runCLI([
      input,
      '-o',
      output,
      '--no-map',
      '--parser',
      path.resolve('test/fixtures/custom-modules/parser.mjs'),
    ]),
  ).rejects.toThrow(/process\.exit:1/);
  expect(error).toHaveBeenCalled();
  expect(exit).toHaveBeenCalledWith(1);
});

test('runCLI watch mode wires chokidar, recompiles on change, and shuts down on SIGINT', async () => {
  const exit = mockExit(false);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');

  let changeHandler: ((file: string) => unknown) | undefined;
  const watcher = {
    add: vi.fn(),
    close: vi.fn(async () => undefined),
    on(event: string, handler: (file?: string) => unknown) {
      if (event === 'ready') queueMicrotask(() => handler());
      if (event === 'change') changeHandler = handler as (file: string) => unknown;
      return watcher;
    },
  };
  const watchSpy = vi.spyOn(chokidar, 'watch').mockReturnValue(watcher as never);

  await runCLI([input, '-o', output, '--watch', '--poll', '--verbose', '--no-map']);

  expect(await read(output)).toContain('color: red');
  expect(watchSpy).toHaveBeenCalled();
  expect(changeHandler).toBeTypeOf('function');

  await fs.writeFile(input, 'a { color: blue; }');
  await Promise.resolve(changeHandler?.(input));
  await vi.waitFor(async () => {
    expect(await read(output)).toContain('color: blue');
  });
  expect(warn.mock.calls.flat().join('\n')).toMatch(/Waiting for file changes/);

  process.emit('SIGINT');
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
});

test('runCLI --ext appends an extension for extensionless outputs', async () => {
  const exit = mockExit();
  const directory = tmp();
  const src = path.join(directory, 'src');
  const dist = path.join(directory, 'dist');
  await fs.mkdir(src, { recursive: true });
  const input = path.join(src, 'style');
  await fs.writeFile(input, 'a { color: red; }');

  await runCLI([input, '--dir', dist, '--base', src, '--ext', '.css', '--no-map']);

  expect(await read(path.join(dist, 'style.css'))).toContain('color: red');
  await expect(fs.access(path.join(dist, '.cssstyle'))).rejects.toThrow();
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI --use keeps config options and replaces only plugins', async () => {
  const exit = mockExit();
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default {
      map: { inline: false },
      plugins: [{
        postcssPlugin: 'config-plugin',
        Declaration(decl) {
          if (decl.prop === 'color') decl.value = 'config';
        },
      }],
    };`,
  );

  await runCLI([input, '-o', output, '-u', path.resolve('test/fixtures/plugins/to-blue.mjs')]);

  expect(await read(output)).toContain('color: blue');
  expect(await fs.readFile(`${output}.map`, 'utf8')).toBeTruthy();
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI --no-map overrides config map settings', async () => {
  const exit = mockExit();
  const directory = tmp();
  const input = await writeCss(directory);
  const output = path.join(directory, 'out.css');
  await fs.writeFile(
    path.join(directory, 'postcss.config.mjs'),
    `export default { map: true, plugins: [] };`,
  );

  await runCLI([input, '-o', output, '--no-map']);

  expect(await read(output)).not.toContain('sourceMappingURL');
  expect(exit).not.toHaveBeenCalled();
});

test('runCLI rejects --parser before importing the module', async () => {
  const exit = mockExit();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const directory = tmp();
  const input = await writeCss(directory);
  const missing = path.join(directory, 'definitely-missing-parser.mjs');

  await expect(
    runCLI([input, '-o', path.join(directory, 'out.css'), '--no-map', '--parser', missing]),
  ).rejects.toThrow(/process\.exit:1/);

  expect(error.mock.calls.flat().join('\n')).toMatch(/UnsupportedSyntaxError/);
  expect(exit).toHaveBeenCalledWith(1);
});
