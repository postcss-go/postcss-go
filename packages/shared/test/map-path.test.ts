import { expect, test } from 'vitest';

import { getMapfile, joinMapAnnotationPath, toSourceMapPath } from '../src/map-path.ts';

test('joinMapAnnotationPath joins annotation paths relative to the CSS output', () => {
  expect(joinMapAnnotationPath('/tmp/output.css', 'maps/out.css.map')).toBe(
    '/tmp/maps/out.css.map',
  );
  expect(joinMapAnnotationPath('output.css', 'maps/out.css.map')).toBe('maps/out.css.map');
  expect(joinMapAnnotationPath(undefined, 'out.css.map')).toBe('out.css.map');
});

test('toSourceMapPath normalizes Windows separators', () => {
  expect(toSourceMapPath('dist\\a.css.map')).toBe('dist/a.css.map');
});

test('getMapfile prefers string annotations and falls back to .map', () => {
  expect(
    getMapfile({
      to: '/tmp/output.css',
      map: { annotation: '../maps/output.css.map' },
    }),
  ).toBe('/tmp/../maps/output.css.map');
  expect(getMapfile({ to: '/tmp/output.css', map: true })).toBe('/tmp/output.css.map');
  expect(getMapfile({ from: '/tmp/input.css', map: true })).toBe('/tmp/input.css.map');
  expect(getMapfile({ map: true })).toBe('to.css.map');
});
