import { createRequire } from 'node:module';
import fs from 'node:fs';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const tokenizePath = require.resolve('../dist/tokenize.js');
const tokenizeSource = fs.readFileSync(tokenizePath, 'utf8');

function withBridge(snapshot, run) {
  let calls = 0;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === './bridge') {
      return {
        call() {
          calls += 1;
          return structuredClone(snapshot);
        },
        errorFromPayload(payload) {
          return new Error(payload.message);
        },
      };
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', tokenizeSource)(
    localRequire,
    module,
    module.exports,
  );
  return run({ calls: () => calls, tokenize: module.exports });
}

test('reuses the batch result for ignoreUnclosed without another RPC', () => {
  withBridge(
    {
      tokens: [
        ['space', ' '],
        ['comment', '/*', 1, 3],
      ],
      positions: [1, 4],
      error: { message: 'Unclosed comment' },
      errorIndex: 1,
    },
    ({ calls, tokenize }) => {
      const processor = tokenize({ css: { valueOf: () => ' /*' }, file: '' });
      expect(processor.nextToken()).toEqual(['space', ' ']);
      expect(processor.nextToken({ ignoreUnclosed: true })).toEqual(['comment', '/*', 1, 3]);
      expect(processor.position()).toBe(4);
      expect(processor.endOfFile()).toBe(true);
      expect(calls()).toBe(1);
    },
  );
});

test('uses UTF-16 offsets from Go without re-encoding in JS', () => {
  withBridge(
    {
      tokens: [['word', '中🔥', 0, 2]],
      positions: [3],
    },
    ({ tokenize }) => {
      const processor = tokenize({ css: { valueOf: () => '中🔥' }, file: '' });
      expect(processor.nextToken()).toEqual(['word', '中🔥', 0, 2]);
      expect(processor.position()).toBe(3);
    },
  );
});

test('preserves past-EOF position for ignored unclosed comments', () => {
  withBridge(
    {
      tokens: [['comment', '/* unclosed', 0, 11]],
      positions: [12],
      error: { message: 'Unclosed comment' },
      errorIndex: 0,
    },
    ({ calls, tokenize }) => {
      const processor = tokenize({ css: { valueOf: () => '/* unclosed' }, file: '' });
      expect(processor.nextToken({ ignoreUnclosed: true })).toEqual([
        'comment',
        '/* unclosed',
        0,
        11,
      ]);
      expect(processor.position()).toBe(12);
      expect(processor.endOfFile()).toBe(true);
      expect(calls()).toBe(1);
    },
  );
});
