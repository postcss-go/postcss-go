export default function identity() {
  return {
    postcssPlugin: 'identity',
    Once() {},
  };
}

identity.postcss = true;
