# Owned AST upstream contract suite

These Vitest files are generated from `vendor/postcss/test` Node/Container AST
suites and run against postcss-go-owned classes (`parse`, `Root`, `Rule`, …).

They are distinct from `pnpm test:upstream:go`, which exercises Go parse/stringify
overrides while still using vendored PostCSS node classes.

## Coverage

- `node.test.ts`, `container.test.ts`
- `rule.test.ts`, `at-rule.test.ts`, `declaration.test.ts`, `comment.test.ts`
- `root.test.ts`, `document.test.ts`, `fromJSON.test.ts`

## Regenerate

```bash
node ./scripts/generate-owned-ast-contract.mjs
```

`helpers.ts`, `document.test.ts`, and `fromJSON.test.ts` are maintained by hand
for postcss-go differences (explicit async `process`/`toResult`, custom-node
`fromJSON`, rejected custom stringifiers).

## Documented differences

- No LazyResult: `process()` and `toResult()` are async and return `Result`.
- Custom AST node types are preserved by `fromJSON` instead of throwing.
- Custom stringifier options remain unsupported on the bridge path.
