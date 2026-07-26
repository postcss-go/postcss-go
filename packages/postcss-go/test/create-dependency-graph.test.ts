import path from 'node:path';
import { expect, test } from 'vitest';

import createDependencyGraph from '../src/createDependencyGraph.ts';

test('dependency graph tracks both file and directory dependencies', () => {
  const graph = createDependencyGraph();
  graph.add({ type: 'dependency', parent: 'src/input.css', file: 'src/partial.css' });
  graph.add({ type: 'dir-dependency', parent: 'src/input.css', dir: 'src/components' });
  const inputPathSuffix = path.normalize('src/input.css');

  expect(graph.dependantsOf('src/partial.css')).toEqual([
    expect.stringMatching(new RegExp(`${inputPathSuffix.replaceAll('\\', '\\\\')}$`)),
  ]);
  expect(graph.dependantsOf('src/components')).toEqual([
    expect.stringMatching(new RegExp(`${inputPathSuffix.replaceAll('\\', '\\\\')}$`)),
  ]);
  expect(graph.dependantsOf('src/missing.css')).toEqual([]);
});
