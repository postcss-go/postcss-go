export default function toBlue() {
  return {
    postcssPlugin: 'to-blue',
    Declaration(decl) {
      if (decl.prop === 'color' && decl.value === 'red') {
        decl.value = 'blue';
      }
    },
  };
}

toBlue.postcss = true;
