# @postcss-go/vite-loader

Vite plugin for `@postcss-go/core`. It processes CSS with the Go-backed engine
before Vite's built-in CSS pipeline.

## Install

```bash
npm i -D @postcss-go/core @postcss-go/vite-loader vite
```

## Usage

```js
// vite.config.js
import postcssGo from '@postcss-go/vite-loader';
import autoprefixer from 'autoprefixer';

export default {
  plugins: [
    postcssGo({
      postcssOptions: {
        config: false,
        plugins: [autoprefixer()],
      },
    }),
  ],
};
```

`postcssOptions` can also be a synchronous or asynchronous function. It
receives `mode`, `env`, `file`, `viteConfig`, and the plugin options.

When `postcssOptions.config` is omitted, the plugin searches from each input
file for a configuration format supported by `@postcss-go/core`. Set it to
`false` to disable lookup or to a path (resolved from Vite's root) for an
explicit config file.

Source maps default to Vite's `css.devSourcemap` in development and
`build.sourcemap` in builds. The plugin returns maps from its transform hook;
downstream Vite/Rolldown CSS handling decides whether they become separate
`.css.map` files in the build output. Warnings, watched dependencies, and
emitted assets are forwarded to Vite. The plugin processes `.css`, `.pcss`, and
`.postcss` requests (including query strings such as `?inline`); preprocessors
such as Sass and Less remain Vite's responsibility and are not run through
postcss-go.

Unless `css.postcss` is explicitly present in the Vite config, the plugin sets
it to an empty plugin list so Vite does not discover and run the same
`postcss.config.*` plugins a second time.
