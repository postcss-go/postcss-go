import { expect, test } from 'vitest';

import getMapfile from '../src/getMapfile.ts';

test('getMapfile respects explicit annotation paths', () => {
  expect(
    getMapfile({
      to: '/tmp/output.css',
      map: { annotation: '../maps/output.css.map' },
    }),
  ).toBe('/tmp/../maps/output.css.map');
});

test('getMapfile falls back to the default .map suffix', () => {
  expect(getMapfile({ to: '/tmp/output.css', map: true })).toBe('/tmp/output.css.map');
});
