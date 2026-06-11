module.exports = {
  plugins: [
    {
      postcssPlugin: 'fixture-alpha-plugin',
      Declaration(decl) {
        if (decl.prop === 'color' && decl.value === 'red') {
          decl.value = 'tomato';
        }
      },
    },
  ],
};

module.exports.postcss = true;
