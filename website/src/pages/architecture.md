---
layout: ../layouts/ContentLayout.astro
title: postcss-go architecture
---

<section class="architecture-hero" aria-labelledby="architecture-title">
  <div class="architecture-hero__eyebrow">SYSTEM DESIGN / CURRENT SHAPE</div>
  <h1 id="architecture-title">Fast where<br /><span>it matters.</span></h1>
  <p>The hot path lives in Go. Runtime bridges keep the ecosystem familiar while the project closes the remaining compatibility gaps.</p>
</section>

<section class="architecture-grid" aria-label="postcss-go architecture">
  <div class="architecture-copy">
    <div class="architecture-points">
      <div><span class="architecture-point architecture-point--acid"></span><p><strong>Go owns the data path</strong>Parse, AST mutation, traversal, stringify, and source maps run in the native engine.</p></div>
      <div><span class="architecture-point architecture-point--violet"></span><p><strong>JSON-RPC keeps runtimes aligned</strong>Node and WASM share a structured contract for AST, locations, maps, errors, and messages.</p></div>
      <div><span class="architecture-point architecture-point--orange"></span><p><strong>The plugin ABI is the frontier</strong>JavaScript plugins still execute at the host boundary while the persistent bridge is being completed.</p></div>
    </div>
  </div>
  <div class="code architecture-code overflow-hidden rounded-2xl border border-white/10 bg-[#08090a] p-5 font-mono text-[11px] leading-7 text-white/60 shadow-2xl md:p-8 md:text-sm">
    <div class="mb-6 flex gap-2">
    <span class="h-2 w-2 rounded-full bg-red-400/70"></span>
    <span class="h-2 w-2 rounded-full bg-yellow-300/70"></span>
    <span class="h-2 w-2 rounded-full bg-acid/70"></span>
  </div>
    <div class="code-line">
      <span class="bracket">CSS</span>
      <span class="muted">→</span>
      <span class="token">Tokenizer</span>
    </div>
    <div class="code-line">
      <span class="muted"> ↓</span>
    </div>
    <div class="code-line">
      <span class="token">Parser</span>
      <span class="muted">→</span>
      <span class="bracket">AST</span>
    </div>
    <div class="code-line">
      <span class="muted"> ↓</span>
    </div>
    <div class="code-line">
      <span class="token">Plugin visitors</span>
      <span class="muted">→</span>
      <span class="bracket">Mutation</span>
    </div>
    <div class="code-line">
      <span class="muted"> ↓</span>
    </div>
    <div class="code-line">
      <span class="token">Stringifier</span>
      <span class="muted">→</span>
      <span class="bracket">CSS + source map</span>
    </div>
  </div>
</section>

<section class="architecture-boundaries" aria-labelledby="boundaries-title">
  <div class="architecture-section-heading"><span>02 / SYSTEM MAP</span><h2 id="boundaries-title">Package boundaries</h2><p>Each layer owns one part of the runtime contract, keeping the native engine independent from host-specific integration.</p></div>
  <div class="architecture-boundaries__table">
    <table>
      <thead><tr><th>Layer</th><th>Responsibility</th></tr></thead>
      <tbody>
        <tr><td><span class="architecture-layer architecture-layer--acid"></span>Go engine</td><td>Tokenize, parse, mutate, traverse, stringify, and generate source maps.</td></tr>
        <tr><td><span class="architecture-layer architecture-layer--violet"></span>Node service</td><td>Manage the child process, request queue, AST conversion, and result handling.</td></tr>
        <tr><td><span class="architecture-layer architecture-layer--orange"></span>JavaScript compatibility</td><td>Load config, run plugins, combine messages, and preserve PostCSS-facing behavior.</td></tr>
        <tr><td><span class="architecture-layer architecture-layer--blue"></span>WASM service</td><td>Expose the same request shape inside a browser Worker.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section class="architecture-flow" aria-labelledby="flow-title">
  <div class="architecture-section-heading"><span>03 / RUNTIME PATH</span><h2 id="flow-title">Request flow</h2><p>A single request crosses the bridge once, then returns with all the data needed by the host runtime.</p></div>
  <div class="architecture-flow__track">
    <div class="architecture-flow__node architecture-flow__node--source"><span>01</span><strong>Node / WASM caller</strong><small>parse · process · stringify</small></div>
    <div class="architecture-flow__connector"><i></i><span>request</span></div>
    <div class="architecture-flow__node architecture-flow__node--bridge"><span>02</span><strong>JSON-RPC bridge</strong><small>AST · locations · options</small></div>
    <div class="architecture-flow__connector"><i></i><span>dispatch</span></div>
    <div class="architecture-flow__node architecture-flow__node--engine"><span>03</span><strong>Go processor</strong><small>parse → mutate → stringify</small></div>
    <div class="architecture-flow__connector"><i></i><span>response</span></div>
    <div class="architecture-flow__node architecture-flow__node--result"><span>04</span><strong>Result payload</strong><small>CSS · map · messages · AST</small></div>
  </div>
</section>

The architecture is intentionally split: performance-sensitive CSS operations
stay native, while runtime-specific compatibility remains close to the host
ecosystem until the plugin ABI is complete.
