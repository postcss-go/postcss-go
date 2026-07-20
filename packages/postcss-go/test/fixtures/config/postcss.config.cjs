module.exports = (ctx) => ({
  map: ctx.options.map,
  plugins: [
    {
      postcssPlugin: 'fixture-config-plugin',
      Declaration(decl) {
        if (decl.prop === 'color' && decl.value === 'red') {
          decl.value = 'tomato';
          if (ctx.env === 'production') {
            decl.cloneAfter({ prop: 'border-color', value: 'black' });
          }
        }
      },
    },
  ],
});

module.exports.postcss = true;
