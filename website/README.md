# postcss-go website

This directory contains the official project website for `postcss-go`. It is a
static Astro 7 site styled with Tailwind CSS 4 through the official Vite plugin
and designed to explain:

- what the Go implementation provides today;
- how its Go, Node.js, JSON-RPC, and WASM layers fit together;
- the current compatibility status against PostCSS 8.5.15; and
- the remaining work required for full PostCSS JavaScript parity.

The site is intentionally separate from the runtime packages under
`packages/`. It does not participate in the CSS processing engine.

## Local development

Install all workspace dependencies from the repository root:

```bash
pnpm install
```

Start the Astro development server:

```bash
pnpm --filter @postcss-go/site dev
```

Build and preview the static output:

```bash
pnpm --filter @postcss-go/site build
pnpm --filter @postcss-go/site preview
```

Run the website checks:

```bash
pnpm --filter @postcss-go/site lint
pnpm --filter @postcss-go/site format:check
```

## GitHub Pages

`.github/workflows/deploy-website.yml` builds and deploys the site when changes
are pushed to `main` or `master`, or when the workflow is started manually.

The expected project-site URL is:

<https://eryue0220.github.io/postcss-go/>

In the repository settings, set **Pages → Build and deployment → Source** to
**GitHub Actions**. Astro uses `/postcss-go` as the base path in GitHub Actions
and `/` for local development.
