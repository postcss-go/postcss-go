---
layout: ../../layouts/GuideLayout.astro
title: Get Started
section: get-started
---

# Get started

## Installation

<div class="mb-10 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-white/[.035]" data-install-tabs>
  <div class="flex gap-[.2rem] overflow-x-auto border-b border-white/[.08] p-[.45rem]" role="tablist" aria-label="Package manager">
    <button class="shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-[.85rem] py-[.65rem] font-mono text-xs text-white/50 transition-colors duration-150 hover:bg-acid/10 hover:text-acid aria-selected:bg-acid/10 aria-selected:text-acid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acid" type="button" role="tab" aria-selected="true" aria-controls="install-pnpm" data-install-tab="pnpm">pnpm</button>
    <button class="shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-[.85rem] py-[.65rem] font-mono text-xs text-white/50 transition-colors duration-150 hover:bg-acid/10 hover:text-acid aria-selected:bg-acid/10 aria-selected:text-acid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acid" type="button" role="tab" aria-selected="false" aria-controls="install-npm" data-install-tab="npm">npm</button>
    <button class="shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-[.85rem] py-[.65rem] font-mono text-xs text-white/50 transition-colors duration-150 hover:bg-acid/10 hover:text-acid aria-selected:bg-acid/10 aria-selected:text-acid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acid" type="button" role="tab" aria-selected="false" aria-controls="install-yarn" data-install-tab="yarn">yarn</button>
    <button class="shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-[.85rem] py-[.65rem] font-mono text-xs text-white/50 transition-colors duration-150 hover:bg-acid/10 hover:text-acid aria-selected:bg-acid/10 aria-selected:text-acid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acid" type="button" role="tab" aria-selected="false" aria-controls="install-bun" data-install-tab="bun">bun</button>
    <button class="shrink-0 cursor-pointer rounded-lg border-0 bg-transparent px-[.85rem] py-[.65rem] font-mono text-xs text-white/50 transition-colors duration-150 hover:bg-acid/10 hover:text-acid aria-selected:bg-acid/10 aria-selected:text-acid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acid" type="button" role="tab" aria-selected="false" aria-controls="install-deno" data-install-tab="deno">deno</button>
  </div>
  <div class="flex items-center justify-between gap-4 overflow-x-auto px-[1.4rem] py-5" id="install-pnpm" role="tabpanel" data-install-panel="pnpm"><code class="whitespace-nowrap border-0! bg-transparent! p-0! text-[.9rem] text-white">pnpm add -D @postcss-go/core</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-install-copy>Copy</button></div>
  <div class="flex items-center justify-between gap-4 overflow-x-auto px-[1.4rem] py-5" id="install-npm" role="tabpanel" data-install-panel="npm" hidden><code class="whitespace-nowrap border-0! bg-transparent! p-0! text-[.9rem] text-white">npm install --save-dev @postcss-go/core</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-install-copy>Copy</button></div>
  <div class="flex items-center justify-between gap-4 overflow-x-auto px-[1.4rem] py-5" id="install-yarn" role="tabpanel" data-install-panel="yarn" hidden><code class="whitespace-nowrap border-0! bg-transparent! p-0! text-[.9rem] text-white">yarn add --dev @postcss-go/core</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-install-copy>Copy</button></div>
  <div class="flex items-center justify-between gap-4 overflow-x-auto px-[1.4rem] py-5" id="install-bun" role="tabpanel" data-install-panel="bun" hidden><code class="whitespace-nowrap border-0! bg-transparent! p-0! text-[.9rem] text-white">bun add --dev @postcss-go/core</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-install-copy>Copy</button></div>
  <div class="flex items-center justify-between gap-4 overflow-x-auto px-[1.4rem] py-5" id="install-deno" role="tabpanel" data-install-panel="deno" hidden><code class="whitespace-nowrap border-0! bg-transparent! p-0! text-[.9rem] text-white">deno add --dev npm:@postcss-go/core</code><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-install-copy>Copy</button></div>
</div>

The package requires **Node.js 18 or newer** and installs a matching optional
native platform package. It does not require `postcss` at runtime.

## Configuration

Create `postcss.config.js`, `.cjs`, or `.mjs` at the project root:

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">postcss.config.js</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">export default {
  plugins: {
    autoprefixer: {},
  },
};</code></pre></div>

You can also use a function configuration when options depend on the current
file or environment:

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">postcss.config.js</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">export default (ctx) =&gt; ({
  map: ctx.env === 'production',
  plugins: {
    autoprefixer: {},
  },
});</code></pre></div>

## First command

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">terminal</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">pnpm postcss-go src/index.css -o dist/index.css</code></pre></div>

For a gradual migration, see the [migration and compatibility guide](../migration/).
For browsers, import `@postcss-go/core/wasm` and follow the
[Browser and WASM](../browser-wasm/) guide.
