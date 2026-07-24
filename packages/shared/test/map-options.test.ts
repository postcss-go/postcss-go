import { expect, test } from 'vitest';

import {
  applyMapAnnotation,
  isExternalSourceMap,
  isSourceMapEnabled,
  mapDefersInlineMode,
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
