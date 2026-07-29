import { afterEach, expect, test, vi } from 'vitest';

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
});

async function importArgs(args: string[], env: Record<string, string | undefined> = {}) {
  process.argv = ['node', 'postcss-go', ...args];
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return (await import('../src/args.ts')).parseCliArgs();
}

test('args normalizes --ext without exposing an engine option', async () => {
  const argv = await importArgs(['input.css', '--dir', 'out', '--ext', 'min.css']);

  expect(argv.ext).toBe('.min.css');
  expect(argv.dir).toBe('out');
  expect(argv.engine).toBeUndefined();
  expect(argv._).toEqual(['input.css']);
});

test('args has no engine default', async () => {
  const argv = await importArgs(['input.css', '--no-map']);

  expect(argv.engine).toBeUndefined();
  expect(argv.map).toBe(false);
});

test('args preserves aliases and collects repeated use options', async () => {
  const argv = await importArgs([
    'input.css',
    '-o',
    'output.css',
    '-u',
    'plugin-a',
    '--use',
    'plugin-b',
  ]);

  expect(argv.output).toBe('output.css');
  expect(argv.o).toBe('output.css');
  expect(argv.use).toEqual(['plugin-a', 'plugin-b']);
  expect(argv.u).toEqual(['plugin-a', 'plugin-b']);
});

test('args rejects conflicting output modes', async () => {
  await expect(importArgs(['input.css', '--output', 'output.css', '--dir', 'out'])).rejects.toThrow(
    /conflict|mutually exclusive/i,
  );
});

test('args rejects directory-only options without a directory', async () => {
  await expect(importArgs(['input.css', '--base', 'src'])).rejects.toThrow(
    /requires.*dir|implies.*dir/i,
  );
});

test('args prints help and exits successfully', async () => {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  const argv = await importArgs(['--help']);
  expect(argv.help).toBe(true);
  expect(write.mock.calls.flat().join('')).toMatch(/Usage:/);

  write.mockRestore();
});

test('args rejects --poll without --watch and defaults bare --poll under --watch', async () => {
  await expect(importArgs(['input.css', '--poll'])).rejects.toThrow(/poll requires watch/i);

  const argv = await importArgs(['input.css', '--watch', '--poll']);
  expect(argv.watch).toBe(true);
  expect(argv.poll).toBe('100');
});

test('args rewrites unknown options into stable CLI errors', async () => {
  await expect(importArgs(['input.css', '--not-a-real-flag'])).rejects.toThrow(
    /Unknown argument: not-a-real-flag/,
  );
});
