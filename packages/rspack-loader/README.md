# @postcss-go/rspack-loader

Rspack loader for `@postcss-go/core`. It calls the Go-backed processor
directly and does not depend on `postcss` or the official `postcss-loader`.

## Install

```bash
npm i -D @postcss-go/core @postcss-go/rspack-loader @rspack/core
```

Add the CSS consumer used by the rest of your Rspack pipeline separately. For
example, projects that already use `css-loader` (or Rspack's
`builtin:css-loader`) can keep it after this loader. This package intentionally
has no dependency on `postcss` or `postcss-loader`.

## Usage

```js
// rspack.config.cjs
const autoprefixer = require('autoprefixer');

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          'css-loader',
          {
            loader: '@postcss-go/rspack-loader',
            options: {
              sourceMap: true,
              postcssOptions: {
                config: false,
                plugins: [autoprefixer()],
              },
            },
          },
        ],
      },
    ],
  },
};
```

`postcssOptions` can also be a synchronous or asynchronous function. It
receives `mode`, `env`, `file`, `rspackLoaderContext`, and the loader options.

When `postcssOptions.config` is omitted, the loader searches from the input
file for the configuration formats supported by `@postcss-go/core`. Set it to
`false` to disable lookup or to a path for an explicit config file.

The loader preserves previous source maps and forwards PostCSS-shaped warning,
dependency, context dependency, missing dependency, build dependency, and
asset messages to Rspack. Custom parsers, syntax implementations,
stringifiers, and `LazyResult` remain outside the postcss-go compatibility
boundary.
