# Markdown paragraph rule

`pnpm --filter @radical/markdown check` checks every Markdown and MDX page under `apps/docs/content`. The root `pnpm check` and `vp run ready` commands include it.

The local oxlint plugin registers `radical-markdown/long-paragraph` through `jsPlugins` in `oxlint.config.ts`. Edit `limits.ts` to change the workspace policy.

Its options are `maxSentences`, default 3, and `maxWords`, default 60. A paragraph fails when either limit is exceeded.

Oxlint 1.88 skips `.md` and `.mdx` files. Its JS plugin API does not support custom parsers or processors. See the installed `oxlint/configuration_schema.json` and [oxlint's API support](https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support).

The Effect CLI transports each Markdown file as a string literal in a temporary JavaScript file, then invokes oxlint with the local plugin. The rule parses that literal with remark, applies the configured limits, and reports the original Markdown path, line, and column.

The CLI removes the temporary directory when it exits. Oxlint runs the rule itself, so no separate prose checker can drift from its configuration.

The parser ignores frontmatter, code blocks, headings, tables, lists, and JSX or MDX components. Inline code and link destinations do not contribute sentence punctuation. Tests use `@effect/vitest` and run entirely in memory.
