export default function warnOnce() {
  return {
    postcssPlugin: 'warn-once',
    Once(root, { result }) {
      result.warn('be careful');
      result.messages.push({ type: 'dependency', file: 'tokens.css' });
      result.messages.push({
        type: 'dir-dependency',
        dir: 'components',
        glob: '**/*.css',
      });
    },
  };
}

warnOnce.postcss = true;
