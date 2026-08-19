import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.POSTCSS_GO_COMPAT_BRIDGE_CLIENT = path.resolve(here, '../bridge-client.cjs');

const require = createRequire(import.meta.url);

function loadCjs(file: string): unknown {
  const module = { exports: {} as unknown };
  const localRequire = (request: string) => {
    if (request.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), request);
      const candidate = [resolved, `${resolved}.js`, `${resolved}.cjs`, `${resolved}.json`].find(
        (entry) => fs.existsSync(entry) && fs.statSync(entry).isFile(),
      );
      if (!candidate) throw new Error(`Cannot find module ${request} from ${file}`);
      return loadCjs(candidate);
    }
    return require(request);
  };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    fs.readFileSync(file, 'utf8'),
  )(localRequire, module, module.exports, file, path.dirname(file));
  return module.exports;
}

const goTokenizer = loadCjs(require.resolve('../dist/tokenize.js')) as TokenizerFactory;
const jsTokenizer = require('../../../vendor/postcss/lib/tokenize.js') as TokenizerFactory;
const { close } = require('../bridge-client.cjs') as { close(): void };

type Token = [string, string, ...number[]];
type Tokenizer = {
  back(token: Token): void;
  endOfFile(): boolean;
  nextToken(opts?: { ignoreUnclosed?: boolean }): Token | undefined;
  position(): number;
};
type TokenizerFactory = (
  input: { css: string; file?: string; error(message: string, pos?: number): never },
  options?: { ignoreErrors?: boolean },
) => Tokenizer;

afterAll(() => close());

function input(css: string) {
  return {
    css,
    file: '',
    error(message: string, pos?: number): never {
      const error = new Error(message) as Error & { pos?: number };
      error.pos = pos;
      throw error;
    },
  };
}

function drain(
  factory: TokenizerFactory,
  css: string,
  nextOpts?: { ignoreUnclosed?: boolean },
  tokOpts?: { ignoreErrors?: boolean },
) {
  const tokenizer = factory(input(css), tokOpts);
  const tokens: Array<{ token: Token; pos: number }> = [];
  let token: Token | undefined;
  while ((token = tokenizer.nextToken(nextOpts))) {
    tokens.push({ token, pos: tokenizer.position() });
  }
  return { tokens, eof: tokenizer.endOfFile(), pos: tokenizer.position() };
}

beforeAll(() => {
  // First RPC compiles and spawns the Go bridge; keep that off Vitest's 5s per-test budget.
  drain(goTokenizer, 'a');
}, 60_000);

function unclosedReason(factory: TokenizerFactory, css: string) {
  try {
    drain(factory, css);
    return null;
  } catch (error) {
    return String((error as Error).message).match(/Unclosed \w+/)?.[0] ?? String(error);
  }
}

const cases = [
  '',
  '\r\n \f\t',
  'ab',
  'aa!bb',
  'a \n b',
  '{:;}',
  '\\(\\{\\"\\@\\\\""',
  '\\\\\\\\{',
  '(ab)',
  'a[bc]',
  '(())("")(/**/)(\\\\)(\n)(',
  '\'"\'"\\""',
  '"\\\\"',
  '"\n\n""\n\n"',
  '@word ',
  '@one{@two()@three""@four;',
  'url(/*\\))',
  'url(")")',
  '@',
  '/* a\nb */',
  'a/* \n */b',
  'a\fb',
  'a\rb\r\nc',
  'a {\n  content: "a";\n  width: calc(1px;)\n  }\n/* small screen */\n@media screen {}',
  '\\0a \\09 \\z ',
  '中文{色:红}',
  'a{content:"🔥"}',
  '.emoji-🔥{x:1}',
];

test.each(cases)('Go tokenizer matches PostCSS for %j', (css) => {
  expect(drain(goTokenizer, css)).toEqual(drain(jsTokenizer, css));
});

test.each([' "', ' /*', 'url(', '/* unclosed', '"abc'])(
  'Go tokenizer matches PostCSS ignore and error paths for %j',
  (css) => {
    expect(drain(goTokenizer, css, undefined, { ignoreErrors: true })).toEqual(
      drain(jsTokenizer, css, undefined, { ignoreErrors: true }),
    );
    expect(drain(goTokenizer, css, { ignoreUnclosed: true })).toEqual(
      drain(jsTokenizer, css, { ignoreUnclosed: true }),
    );
    expect(unclosedReason(goTokenizer, css)).toEqual(unclosedReason(jsTokenizer, css));
  },
);

test('Go tokenizer matches PostCSS per-token ignoreUnclosed and back()', () => {
  expect(drain(goTokenizer, "How's it going (", { ignoreUnclosed: true })).toEqual(
    drain(jsTokenizer, "How's it going (", { ignoreUnclosed: true }),
  );

  const go = goTokenizer(input('ab cd'));
  const js = jsTokenizer(input('ab cd'));
  const first = go.nextToken();
  const jsFirst = js.nextToken();
  go.back(first!);
  js.back(jsFirst!);
  expect({ token: go.nextToken(), pos: go.position() }).toEqual({
    token: js.nextToken(),
    pos: js.position(),
  });
});
