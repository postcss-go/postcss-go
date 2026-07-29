import { expect, test } from 'vitest';

import {
  applyMapAnnotation,
  applyMapAnnotationAsync,
  isExternalSourceMap,
  isSourceMapEnabled,
  mapDefersInlineMode,
  materializePreviousMap,
  normalizeProcessOptions,
} from '../src/map-options.ts';

test('normalizeProcessOptions enables auto map mode when map is omitted', () => {
  expect(normalizeProcessOptions({ from: 'a.css' })).toEqual({
    from: 'a.css',
    mapAuto: true,
    mapInlineAuto: true,
  });
});

test('normalizeProcessOptions maps bare map:true to inline bridge flags', () => {
  expect(normalizeProcessOptions({ map: true, to: 'out.css' })).toEqual({
    map: true,
    to: 'out.css',
    mapInline: true,
    mapAnnotationDisabled: true,
  });
});

test('normalizeProcessOptions preserves already-flat map output flags', () => {
  expect(
    normalizeProcessOptions({
      map: true,
      mapInline: false,
      mapAnnotation: 'out.css.map',
      mapAnnotationDisabled: false,
    }),
  ).toEqual({
    map: true,
    mapInline: false,
    mapAnnotation: 'out.css.map',
    mapAnnotationDisabled: false,
  });
});

test('normalizeProcessOptions materializes prev paths and annotation map files', () => {
  const normalized = normalizeProcessOptions(
    {
      from: 'src/a.css',
      to: 'dist/a.css',
      map: {
        inline: false,
        annotation: 'maps/a.css.map',
        prev: () => 'src/a.css.map',
      },
    },
    (to, annotation) => `${to}:${annotation}`,
  );

  expect(normalized).toMatchObject({
    map: true,
    mapInline: false,
    mapAnnotation: 'maps/a.css.map',
    mapAnnotationDisabled: false,
    previousMapPath: 'src/a.css.map',
    previousMapUrl: 'src/a.css.map',
    mapFile: 'dist/a.css:maps/a.css.map',
  });
});

test('normalizeProcessOptions disables previous maps and preserves annotations', () => {
  expect(
    normalizeProcessOptions({
      map: { annotation: false, prev: false },
    }),
  ).toMatchObject({
    map: true,
    preserveAnnotation: true,
    previousMapDisabled: true,
    mapAnnotationDisabled: true,
  });
});

test('normalizeProcessOptions serializes source-map consumer and generator shapes', () => {
  const consumer = {
    sources: ['input.css'],
    sourcesContent: ['a{}'],
    file: 'output.css',
    sourceRoot: null,
    _mappings: 'AAAA',
    _sources: { toArray: () => ['input.css'] },
    _names: { toArray: () => [] },
    originalPositionFor() {
      return {};
    },
  };
  const generator = {
    toJSON() {
      return {
        version: 3,
        sources: ['input.css'],
        names: [],
        mappings: 'AAAA',
        sourcesContent: ['a{}'],
      };
    },
  };

  for (const prev of [consumer, generator]) {
    const normalized = normalizeProcessOptions({ map: { prev } });
    expect(JSON.parse(normalized.previousMap!)).toMatchObject({
      version: 3,
      sources: ['input.css'],
      mappings: 'AAAA',
    });
    expect(normalized.previousMap).not.toBe('{}');
  }
});

test('applyMapAnnotation evaluates annotation callbacks', () => {
  const root = { type: 'root' };
  const applied = applyMapAnnotation(
    {
      to: 'out.css',
      map: {
        annotation: (file, received) => {
          expect(file).toBe('out.css');
          expect(received).toBe(root);
          return 'maps/out.css.map';
        },
      },
    },
    root,
  );
  expect(applied.map).toEqual({ annotation: 'maps/out.css.map' });
});

test('applyMapAnnotationAsync awaits annotation callbacks', async () => {
  const root = { type: 'root' };
  const applied = await applyMapAnnotationAsync(
    {
      to: 'out.css',
      map: {
        annotation: async (file, received) => {
          expect(file).toBe('out.css');
          expect(received).toBe(root);
          return 'maps/async.css.map';
        },
      },
    },
    root,
  );
  expect(applied.map).toEqual({ annotation: 'maps/async.css.map' });
});

test('materializePreviousMap evaluates map.prev once and replaces the callback', () => {
  let calls = 0;
  const options = materializePreviousMap({
    from: 'input.css',
    map: {
      prev(file?: string) {
        calls++;
        return { version: 3, sources: [file] };
      },
    },
  });

  expect(calls).toBe(1);
  expect(options.map.prev).toEqual({ version: 3, sources: ['input.css'] });
  expect(materializePreviousMap(options)).toBe(options);
  expect(calls).toBe(1);
});

test('materializePreviousMap rejects thenable map.prev values', () => {
  expect(() =>
    materializePreviousMap({
      from: 'input.css',
      map: {
        prev: async () => ({ version: 3 }),
      },
    }),
  ).toThrow(/map\.prev returned a Promise/);

  expect(() =>
    materializePreviousMap({
      from: 'input.css',
      map: {
        prev: Promise.resolve({ version: 3 }),
      },
    }),
  ).toThrow(/map\.prev returned a Promise/);
});

test('map mode helpers match PostCSS inline/external predicates', () => {
  expect(isSourceMapEnabled(undefined)).toBe(false);
  expect(isSourceMapEnabled(true)).toBe(true);
  expect(isExternalSourceMap({ inline: false })).toBe(true);
  expect(isExternalSourceMap({ annotation: false })).toBe(true);
  expect(isExternalSourceMap(true)).toBe(false);
  expect(mapDefersInlineMode(undefined)).toBe(true);
  expect(mapDefersInlineMode({})).toBe(true);
  expect(mapDefersInlineMode({ inline: false })).toBe(false);
});
