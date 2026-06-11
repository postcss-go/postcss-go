import { expect, test } from 'vitest';

import createDependencyGraph from '../lib/DependencyGraph.js';
import getMapfile from '../lib/getMapfile.js';

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

test('dependency graph tracks both file and directory dependencies', () => {
  const graph = createDependencyGraph();
  graph.add({ type: 'dependency', parent: 'src/input.css', file: 'src/partial.css' });
  graph.add({ type: 'dir-dependency', parent: 'src/input.css', dir: 'src/components' });

  expect(graph.dependantsOf('src/partial.css')).toEqual([
    expect.stringMatching(/src\/input\.css$/),
  ]);
  expect(graph.dependantsOf('src/components')).toEqual([
    expect.stringMatching(/src\/input\.css$/),
  ]);
  expect(graph.dependantsOf('src/missing.css')).toEqual([]);
});
