module.exports = {
  plugins: [
    {
      postcssPlugin: 'fixture-beta-plugin',
      Declaration(decl) {
        if (decl.prop === 'color' && decl.value === 'red') {
          decl.value = 'deepskyblue';
        }
      },
    },
  ],
};

module.exports.postcss = true;
