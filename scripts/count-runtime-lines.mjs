// Comparable physical source-line counts; tests/generated code are not runtime wins.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseline = process.argv.includes('--baseline');
const files = execFileSync(
  'git',
  baseline
    ? ['ls-tree', '-r', '--name-only', 'HEAD']
    : ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
const totals = { typescript: 0, go: 0 };
for (const file of new Set(files)) {
  const language = /^packages\/[^/]+\/src\/.*\.tsx?$/.test(file)
    ? 'typescript'
    : /^(internal|pkg|cmd)\/.*\.go$/.test(file)
      ? 'go'
      : undefined;
  if (!language || /(_test\.go$|\/generated\/|_gen\.go$|\/cmd\/genprotocol\/)/.test(file)) continue;
  const source = baseline
    ? execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' })
    : readFileSync(file, 'utf8');
  totals[language] += source.split('\n').length - Number(source.endsWith('\n'));
}
console.log(
  JSON.stringify(
    {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      source: baseline ? 'commit' : 'working-tree',
      physicalRuntimeLines: totals,
    },
    null,
    2,
  ),
);
