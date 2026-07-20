# Changesets

Add a changeset for every change that should be included in the next release:

```bash
pnpm changeset
```

The generated Markdown file should be committed with the change. The release
workflow uses these files to open a versioning pull request and publish the
packages after that pull request is merged.
