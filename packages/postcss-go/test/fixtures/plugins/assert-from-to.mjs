import path from 'node:path';

export default function assertFromTo() {
  return {
    postcssPlugin: 'assert-from-to',
    Once(_root, { result }) {
      const { from, to } = result.opts;
      if (from && to && path.resolve(from) === path.resolve(to)) {
        throw new Error(`from and to must differ: ${from}`);
      }
    },
  };
}

assertFromTo.postcss = true;
