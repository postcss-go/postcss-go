---
layout: ../layouts/ContentLayout.astro
title: Architecture
---

<section class="mb-14 border-b border-violet/40 pb-12" aria-labelledby="architecture-title">
  <div class="mb-6 font-mono text-[.68rem] uppercase tracking-[.16em] text-violet">SYSTEM DESIGN / CURRENT SHAPE</div>
  <h1 id="architecture-title" class="m-0 text-[clamp(3.5rem,9vw,7rem)] leading-[.86] tracking-[-.08em]">
    Fast where<br />
    <span class="text-violet">it matters.</span>
  </h1>
  <p class="mb-0 mt-6 max-w-[42rem] text-[1.1rem] leading-[1.7] text-white/70">A fast Go CSS engine behind a PostCSS-compatible JavaScript surface. The Go core owns the hot path; Node and browser packages own ecosystem integration.</p>
</section>

<section class="mb-16 grid grid-cols-1 items-stretch gap-8 min-[761px]:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]" aria-label="postcss-go architecture">
  <div class="flex items-center">
    <div class="grid gap-6">
      <div class="flex gap-[.85rem]">
        <span class="mt-[.4rem] h-[.55rem] w-[.55rem] shrink-0 rounded-full bg-acid"></span>
        <p class="m-0 text-[.9rem] leading-[1.65] text-white/50">
          <strong class="mb-1 block font-mono text-xs tracking-[.04em] text-white">Go owns the data path</strong>
          Parse, AST mutation, plugin visitors, stringify, warnings, and source maps run in the native engine.
        </p>
      </div>
      <div class="flex gap-[.85rem]">
        <span class="mt-[.4rem] h-[.55rem] w-[.55rem] shrink-0 rounded-full bg-violet"></span>
        <p class="m-0 text-[.9rem] leading-[1.65] text-white/50">
          <strong class="mb-1 block font-mono text-xs tracking-[.04em] text-white">A narrow native boundary</strong>
          Node uses a compact binary AST over Node-API; WASM keeps its Worker message contract.
        </p>
      </div>
      <div class="flex gap-[.85rem]">
        <span class="mt-[.4rem] h-[.55rem] w-[.55rem] shrink-0 rounded-full bg-orange-300"></span>
        <p class="m-0 text-[.9rem] leading-[1.65] text-white/50">
          <strong class="mb-1 block font-mono text-xs tracking-[.04em] text-white">JavaScript owns the ecosystem surface</strong>
          Config, plugins, and PostCSS-shaped results stay in Node; Go also owns the parse-free no-work map path.
        </p>
      </div>
    </div>
  </div>
  <div class="code overflow-hidden rounded-2xl border border-white/10 bg-[#08090a] p-5 pt-[1.4rem]! font-mono text-[11px] leading-7 text-white/60 shadow-2xl md:p-8 md:text-sm max-[760px]:min-h-0">
    <div class="mb-6 flex gap-2">
    <span class="h-2 w-2 rounded-full bg-red-400/70"></span>
    <span class="h-2 w-2 rounded-full bg-yellow-300/70"></span>
    <span class="h-2 w-2 rounded-full bg-acid/70"></span>
  </div>
    <div class="code-line">
      <span class="text-violet">CSS</span>
      <span class="text-white/50">→</span>
      <span class="text-acid">Tokenizer</span>
    </div>
    <div class="code-line">
      <span class="text-white/50"> ↓</span>
    </div>
    <div class="code-line">
      <span class="text-acid">Parser</span>
      <span class="text-white/50">→</span>
      <span class="text-violet">AST</span>
    </div>
    <div class="code-line">
      <span class="text-white/50"> ↓</span>
    </div>
    <div class="code-line">
      <span class="text-acid">Plugin visitors</span>
      <span class="text-white/50">→</span>
      <span class="text-violet">Mutation</span>
    </div>
    <div class="code-line">
      <span class="text-white/50"> ↓</span>
    </div>
    <div class="code-line">
      <span class="text-acid">Stringifier</span>
      <span class="text-white/50">→</span>
      <span class="text-violet">CSS + source map</span>
    </div>
  </div>
</section>

<section class="mt-20 max-[760px]:mt-16" aria-labelledby="boundaries-title">
  <div class="mb-6">
    <span class="font-mono text-[.68rem] uppercase tracking-[.14em] text-violet">02 / SYSTEM MAP</span>
    <h2 id="boundaries-title" class="mb-[.8rem] mt-[.7rem] text-[clamp(2rem,5vw,3.5rem)] leading-[.95] tracking-[-.06em]">Package boundaries</h2>
    <p class="m-0 leading-[1.7] text-white/50">Each layer owns one part of the runtime contract, keeping the native engine independent from host-specific integration.</p>
  </div>
  <div class="overflow-x-auto rounded-[.85rem] border border-white/10">
    <table class="w-full border-separate border-spacing-0 text-left">
      <thead><tr><th class="border-b border-white/[.08] px-[1.1rem] py-4 text-left font-mono text-[.68rem] uppercase tracking-[.12em] text-white/40">Layer</th><th class="border-b border-white/[.08] px-[1.1rem] py-4 text-left font-mono text-[.68rem] uppercase tracking-[.12em] text-white/40">Responsibility</th></tr></thead>
      <tbody>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-acid"></span>Go engine</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Parse, AST mutation, plugin visitors, stringify, warnings, and source maps.</td></tr>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-violet"></span>Node service</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Native addon loading, Node-API async work, synchronous calls, option normalization, and result handling.</td></tr>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-orange-300"></span>JavaScript compatibility</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Config, JS plugins, message combining, and PostCSS-shaped results. Map options are normalized in <code>@postcss-go/shared</code>; Go owns map generation, previous maps, and annotations.</td></tr>
        <tr><td class="w-[34%] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-cyan-300"></span>WASM service</td><td class="px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Same service contract as Node, via a Worker and Go WASM.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section class="mt-20 max-[760px]:mt-16" aria-labelledby="flow-title">
  <div class="mb-6">
    <span class="font-mono text-[.68rem] uppercase tracking-[.14em] text-violet">03 / RUNTIME PATH</span>
    <h2 id="flow-title" class="mb-[.8rem] mt-[.7rem] text-[clamp(2rem,5vw,3.5rem)] leading-[.95] tracking-[-.06em]">Hybrid request flow</h2>
    <p class="m-0 leading-[1.7] text-white/50">JavaScript owns config, plugins, and PostCSS-shaped results. One request crosses the bridge into Go for parse, AST work, and stringify, then returns with CSS, map, messages, and AST.</p>
  </div>
  <div class="mb-8 grid grid-cols-1 items-center gap-2 min-[761px]:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] min-[761px]:gap-x-5 min-[761px]:gap-y-[.65rem]">
    <div class="min-h-0 rounded-[.85rem] border border-white/10 bg-white/[.035] p-4 min-[761px]:min-h-36">
      <span class="font-mono text-[.68rem] tracking-[.1em] text-violet">01</span>
      <strong class="mt-[.8rem] block font-mono text-[.8rem] min-[761px]:mt-[1.7rem]">Host runtime</strong>
      <small class="mt-[.45rem] block text-[.72rem] leading-normal text-white/50">CLI · Node · WASM · plugins</small>
    </div>
    <div class="ml-[1.2rem] grid grid-cols-[auto_1fr] items-center justify-items-start gap-[.35rem] font-mono text-[.58rem] uppercase tracking-[.08em] text-white/40 min-[761px]:ml-0 min-[761px]:grid-cols-1 min-[761px]:justify-items-center">
      <span class="relative block h-[1.2rem] w-px bg-acid/50 after:absolute after:bottom-0 after:right-[-.2rem] after:h-[.4rem] after:w-[.4rem] after:-rotate-45 after:border-b after:border-l after:border-acid after:content-[''] min-[761px]:h-px min-[761px]:w-[2.4rem] min-[761px]:after:right-0 min-[761px]:after:top-[-.2rem] min-[761px]:after:bottom-auto min-[761px]:after:rotate-45 min-[761px]:after:border-b-0 min-[761px]:after:border-l-0 min-[761px]:after:border-r min-[761px]:after:border-t"></span>
      <span>request</span>
    </div>
    <div class="min-h-0 rounded-[.85rem] border border-white/10 bg-white/[.035] p-4 min-[761px]:min-h-36">
      <span class="font-mono text-[.68rem] tracking-[.1em] text-violet">02</span>
      <strong class="mt-[.8rem] block font-mono text-[.8rem] min-[761px]:mt-[1.7rem]">Node-API boundary</strong>
      <small class="mt-[.45rem] block text-[.72rem] leading-normal text-white/50">binary AST · options · errors</small>
    </div>
    <div class="ml-[1.2rem] grid grid-cols-[auto_1fr] items-center justify-items-start gap-[.35rem] font-mono text-[.58rem] uppercase tracking-[.08em] text-white/40 min-[761px]:ml-0 min-[761px]:grid-cols-1 min-[761px]:justify-items-center">
      <span class="relative block h-[1.2rem] w-px bg-acid/50 after:absolute after:bottom-0 after:right-[-.2rem] after:h-[.4rem] after:w-[.4rem] after:-rotate-45 after:border-b after:border-l after:border-acid after:content-[''] min-[761px]:h-px min-[761px]:w-[2.4rem] min-[761px]:after:right-0 min-[761px]:after:top-[-.2rem] min-[761px]:after:bottom-auto min-[761px]:after:rotate-45 min-[761px]:after:border-b-0 min-[761px]:after:border-l-0 min-[761px]:after:border-r min-[761px]:after:border-t"></span>
      <span>dispatch</span>
    </div>
    <div class="min-h-0 rounded-[.85rem] border border-acid/40 bg-white/[.035] p-4 min-[761px]:min-h-36">
      <span class="font-mono text-[.68rem] tracking-[.1em] text-acid">03</span>
      <strong class="mt-[.8rem] block font-mono text-[.8rem] text-acid min-[761px]:mt-[1.7rem]">Go processor</strong>
      <small class="mt-[.45rem] block text-[.72rem] leading-normal text-white/50">parse → mutate → stringify</small>
    </div>
    <div class="ml-[1.2rem] grid grid-cols-[auto_1fr] items-center justify-items-start gap-[.35rem] font-mono text-[.58rem] uppercase tracking-[.08em] text-white/40 min-[761px]:ml-0 min-[761px]:grid-cols-1 min-[761px]:justify-items-center">
      <span class="relative block h-[1.2rem] w-px bg-acid/50 after:absolute after:bottom-0 after:right-[-.2rem] after:h-[.4rem] after:w-[.4rem] after:-rotate-45 after:border-b after:border-l after:border-acid after:content-[''] min-[761px]:h-px min-[761px]:w-[2.4rem] min-[761px]:after:right-0 min-[761px]:after:top-[-.2rem] min-[761px]:after:bottom-auto min-[761px]:after:rotate-45 min-[761px]:after:border-b-0 min-[761px]:after:border-l-0 min-[761px]:after:border-r min-[761px]:after:border-t"></span>
      <span>response</span>
    </div>
    <div class="min-h-0 rounded-[.85rem] border border-white/10 bg-white/[.035] p-4 min-[761px]:min-h-36">
      <span class="font-mono text-[.68rem] tracking-[.1em] text-violet">04</span>
      <strong class="mt-[.8rem] block font-mono text-[.8rem] min-[761px]:mt-[1.7rem]">PostCSS-shaped result</strong>
      <small class="mt-[.45rem] block text-[.72rem] leading-normal text-white/50">CSS · map · messages · AST</small>
    </div>
  </div>
  <div class="overflow-x-auto rounded-[.85rem] border border-white/10">
    <table class="w-full border-separate border-spacing-0 text-left">
      <thead><tr><th class="border-b border-white/[.08] px-[1.1rem] py-4 text-left font-mono text-[.68rem] uppercase tracking-[.12em] text-white/40">Module</th><th class="border-b border-white/[.08] px-[1.1rem] py-4 text-left font-mono text-[.68rem] uppercase tracking-[.12em] text-white/40">Responsibility</th></tr></thead>
      <tbody>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-violet"></span>service</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Shared async service contract.</td></tr>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-acid"></span>native</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Node-API async/sync operations, compact AST codec, and option normalization.</td></tr>
        <tr><td class="w-[34%] border-b border-white/[.08] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-cyan-300"></span>browser / wasm</td><td class="border-b border-white/[.08] px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Worker-backed service; <code>@postcss-go/core/wasm</code> ships the WASM assets.</td></tr>
        <tr><td class="w-[34%] px-[1.1rem] py-4 align-top font-mono text-[.82rem] leading-[1.6]"><span class="mr-[.65rem] inline-block h-2 w-2 rounded-full bg-orange-300"></span>cli</td><td class="px-[1.1rem] py-4 align-top leading-[1.6] text-white/50">Config, JS plugins, message combining, and writing Go-generated CSS and maps.</td></tr>
      </tbody>
    </table>
  </div>
</section>
