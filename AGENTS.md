# AGENTS.md

## Rules

- Performance first. Never use temporary workarounds; fix the root cause.
- Write every change with Effect v4: `Effect`, `Layer`, `Schema`, typed errors. No raw `async`/`await`, `try`/`catch`, or `throw` in library code.
- Tests must not be flaky and must test what their name claims. Use `it.effect` and `assert` from `@effect/vitest`, `TestClock`, and in-memory layers. No real timers, network, or shared mutable state.
- After every change, run `pnpm exec ultracite fix` and `pnpm exec ultracite check`. Before finishing, run `vp run ready` (Ultracite, `vp check`, Effect type check, tests).

## Tooling

Vite+ (`vp`) runs dev, check, test, and pack; docs are in `node_modules/vite-plus/docs`. Ultracite owns lint and format rules in `oxlint.config.ts` and `oxfmt.config.ts`.

## Agent skills

### Issue tracker

Local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, as a `Status:` line per issue. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
