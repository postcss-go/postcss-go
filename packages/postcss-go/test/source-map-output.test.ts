import { expect, test } from 'vitest';

import { prepareStringifyOptions } from '../src/source-map-output.ts';

test('prepareStringifyOptions inherits previous inline map mode', () => {
  const node = {
    source: {
      input: {
        map: {
          inline: true,
        },
      },
    },
  };

  expect(prepareStringifyOptions(node, {})).toEqual({ map: { inline: true } });
  expect(prepareStringifyOptions(node, { map: false })).toEqual({ map: false });
  expect(prepareStringifyOptions(node, { map: { annotation: true } })).toEqual({
    map: { annotation: true, inline: true },
  });
  expect(prepareStringifyOptions({}, { map: { annotation: true } })).toEqual({
    map: { annotation: true },
  });
});
