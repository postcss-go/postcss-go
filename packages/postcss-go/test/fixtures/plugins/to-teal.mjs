const plugin = {
  postcssPlugin: 'to-teal',
  Declaration(decl) {
    if (decl.prop === 'color' && decl.value === 'red') {
      decl.value = 'teal';
    }
  },
};

export default plugin;
