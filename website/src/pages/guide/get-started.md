---
layout: ../../layouts/GuideLayout.astro
title: Get started
section: get-started
---

# Get started

## Installation

<div class="install-tabs" data-install-tabs>
  <div class="install-tabs__list" role="tablist" aria-label="Package manager">
    <button class="install-tabs__tab" type="button" role="tab" aria-selected="true" aria-controls="install-pnpm" data-install-tab="pnpm">pnpm</button>
    <button class="install-tabs__tab" type="button" role="tab" aria-selected="false" aria-controls="install-npm" data-install-tab="npm">npm</button>
    <button class="install-tabs__tab" type="button" role="tab" aria-selected="false" aria-controls="install-yarn" data-install-tab="yarn">yarn</button>
    <button class="install-tabs__tab" type="button" role="tab" aria-selected="false" aria-controls="install-bun" data-install-tab="bun">bun</button>
    <button class="install-tabs__tab" type="button" role="tab" aria-selected="false" aria-controls="install-deno" data-install-tab="deno">deno</button>
  </div>
  <div class="install-tabs__panel" id="install-pnpm" role="tabpanel" data-install-panel="pnpm"><code>pnpm add -D @postcss-go/core postcss</code><button class="code-sample__copy" type="button" data-install-copy>Copy</button></div>
  <div class="install-tabs__panel" id="install-npm" role="tabpanel" data-install-panel="npm" hidden><code>npm install --save-dev @postcss-go/core postcss</code><button class="code-sample__copy" type="button" data-install-copy>Copy</button></div>
  <div class="install-tabs__panel" id="install-yarn" role="tabpanel" data-install-panel="yarn" hidden><code>yarn add --dev @postcss-go/core postcss</code><button class="code-sample__copy" type="button" data-install-copy>Copy</button></div>
  <div class="install-tabs__panel" id="install-bun" role="tabpanel" data-install-panel="bun" hidden><code>bun add --dev @postcss-go/core postcss</code><button class="code-sample__copy" type="button" data-install-copy>Copy</button></div>
  <div class="install-tabs__panel" id="install-deno" role="tabpanel" data-install-panel="deno" hidden><code>deno add --dev npm:@postcss-go/core npm:postcss</code><button class="code-sample__copy" type="button" data-install-copy>Copy</button></div>
</div>

The package requires **Node.js 18 or newer**. The CLI launches the Go engine and
keeps plugin configuration in the familiar PostCSS format.

## Configuration

Create `postcss.config.js`, `.cjs`, or `.mjs` at the project root:

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">postcss.config.js</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>export default {
  plugins: {
    autoprefixer: {},
  },
};</code></pre></div>

You can also use a function configuration when options depend on the current
file or environment:

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">postcss.config.js</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>export default (ctx) =&gt; ({
  map: ctx.env === 'production',
  plugins: {
    autoprefixer: {},
  },
});</code></pre></div>

## First command

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">terminal</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>pnpm postcss-go src/index.css -o dist/index.css</code></pre></div>

For a gradual migration, keep your existing `postcss.config.js` and replace
the `postcss` CLI invocation with `postcss-go`.
