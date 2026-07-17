# README Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the top-level README so the experimental status is immediately visible and the remaining documentation is easier to scan.

**Architecture:** Modify only `README.md`. Preserve the existing technical content while changing section order, removing redundant sections, and improving spacing and grouping.

**Tech Stack:** Markdown, existing repository commands and links.

## Global Constraints

- Keep the project explicitly marked as experimental.
- Do not alter source code or unrelated working-tree changes.
- Preserve existing commands, examples, links, and technical claims.
- Remove the table of contents, Visitor Hooks, and Current Limitations sections.

---

### Task 1: Reorganize the top-level README

**Files:**
- Modify: `/Users/eryue0220/cin/eryue/css/postcss-go/README.md`

**Interfaces:**
- Consumes: Existing README content and links.
- Produces: A readable README with the experimental notice and approved section order.

- [ ] Add the experimental-project notice immediately after the title.
- [ ] Move Current Status before the project overview and combine unfinished work into that section.
- [ ] Remove the table of contents, Visitor Hooks, and Current Limitations sections.
- [ ] Keep Packages, CLI, Go API, Development, Verification, Benchmark, and Acknowledgements in the approved order.
- [ ] Normalize paragraph, list, table, and code-block spacing without changing command semantics.

### Task 2: Validate the documentation change

**Files:**
- Inspect: `/Users/eryue0220/cin/eryue/css/postcss-go/README.md`

- [ ] Confirm headings are ordered as designed and code fences are balanced.
- [ ] Confirm all existing repository links and command blocks remain present.
- [ ] Inspect `git diff -- README.md` and confirm no unrelated files were changed by this task.
