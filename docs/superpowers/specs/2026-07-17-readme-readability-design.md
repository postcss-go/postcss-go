# README Readability Design

## Goal

Improve the top-level README's readability without changing the project's technical claims, commands, API examples, or scope.

## Structure

Place an explicit experimental-project notice immediately after the title, followed by the existing project overview. Remove the table of contents, Visitor Hooks, and Current Limitations sections. Keep the remaining content in this order:

1. Current status
2. Project overview
3. Packages
4. CLI
5. Go API
6. Development
7. Verification
8. Benchmark
9. Acknowledgements

Fold unfinished capabilities into the status section so limitations are not repeated later.

## Presentation

Use shorter paragraphs, consistent heading levels, readable tables, and grouped code blocks. Keep existing links and commands intact unless a wording change is necessary to remove duplication.

## Validation

Review the rendered Markdown structure through a heading/list/code-fence check and inspect the final diff. No source-code tests are required because this change is documentation-only.
