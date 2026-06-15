# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Project Sentinel is a resilience-engineering monorepo (npm workspaces). It forms a
closed feedback loop: `chaos-monkey` injects faults → `health-monitor` detects
outages → `incident-recorder` appends to `docs/incident-history.log` → the Next.js
`app` renders live health and incident history. See `README.md` and
`docs/architecture.md` for the full picture; don't duplicate them here.

## Commands

Run from the repo root unless noted.

| Task | Command |
| --- | --- |
| Install everything | `npm install` |
| Run both services (watch) | `npm run dev:services` |
| Run dashboard (http://localhost:3000) | `npm run dev:app` |
| Runtime fault injection | `npm run chaos` |
| Source-mutation chaos (writes) | `npm run code-chaos -- --apply` |
| Revert source mutations | `npm run code-chaos:restore` |
| Build all | `npm run build` |
| Typecheck all | `npm run typecheck` |
| Lint all | `npm run lint` |

Run a script in one workspace: `npm run <script> --workspace @sentinel/health-monitor`
(workspaces: `app`, `@sentinel/health-monitor`, `@sentinel/incident-recorder`,
`@sentinel/scripts`).

Once Vitest is wired up (see Testing): all tests `npm run test`; a single file
`npx vitest run <path>`; watch mode `npx vitest`.

## Strict TypeScript

- Every workspace tsconfig extends `tsconfig.base.json`. Never weaken `strict` or
  `noUncheckedIndexedAccess` in a workspace override.
- No `any` — use `unknown` plus narrowing.
- Do not reach for the non-null `!` operator to silence `noUncheckedIndexedAccess`;
  guard or provide a default. The only acceptable `arr[i]!` is where the index is
  provably in range (e.g. `pick()` in the chaos scripts).
- No `@ts-ignore` / `@ts-expect-error` without an inline comment justifying it.
- ESM only (`"type": "module"` in services/scripts). Keep import style consistent
  with the existing files.
- `npm run typecheck` must pass with zero errors before any commit.

## Naming conventions

These match the existing tree — follow them:

- **Directories & files:** `kebab-case` (`health-monitor`, `code-chaos-monkey.ts`).
- **Packages:** `@sentinel/<name>` for services and scripts; the root package is
  `project-sentinel` and the dashboard is the unscoped `app`.
- **Constants / env-derived config:** `UPPER_SNAKE_CASE` (`MONITOR_URL`,
  `CHECK_INTERVAL_MS`).
- **Variables & functions:** `camelCase` (`raiseIncident`, `lineRe`).
- **Types, interfaces, React components:** `PascalCase` (`Incident`, `Severity`,
  `Dashboard`).
- **String-literal union members:** `UPPER` (`"INFO" | "WARN" | "CRITICAL"`).
- **Test files:** `<name>.test.ts`, colocated next to the source under test.

## Testing requirements

- **Framework: Vitest** (`describe` / `it` / `expect`). Tests are colocated as
  `*.test.ts` beside the code they cover.
- Each workspace exposes a `test` script; the root `npm run test` fans out with
  `--workspaces --if-present`.
- Pure logic must be unit-tested. Priority targets:
  - `health-monitor` — `sweep()` edge transitions: UP→DOWN raises a `CRITICAL`
    incident, DOWN→UP raises an `INFO` incident; no incident on a steady state.
  - `incident-recorder` — `formatLine()` / `readIncidents()` round-trip: a line
    written by `formatLine` must parse back to the same structured incident.
- Every bug fix ships with a regression test (see Resolution Protocol).
- Gate before commit: `npm run typecheck && npm run test` must pass.

## Architecture notes

- **Inter-service communication is plain HTTP/JSON.** Service URLs come from env
  vars (`MONITOR_URL`, `RECORDER_URL`) — never hardcode hosts/ports.
- **The incident log line format is a contract.** The writer (`formatLine`) and the
  reader regex (`readIncidents`) both live in
  `services/incident-recorder/src/index.ts` and must change together. The
  `/incidents` response shape and `app/src/app/page.tsx` must stay in sync with it.
- **Two distinct chaos tools — do not conflate them:**
  - `scripts/chaos-monkey.ts` — *runtime* fault injection over HTTP against a
    running `health-monitor`.
  - `scripts/code-chaos-monkey.ts` — *source* mutation testing. Scoped to
    `services/` only, dry-run by default, backs up before writing, reversible via
    `npm run code-chaos:restore`.

## Resolution Protocol

When diagnosing and fixing a failure or incident, follow these steps in order:

1. **Check `docs/incident-history.log`.** Read the most recent entries first.
2. **Search previous incidents.** Grep the log for the same `service` and a
   matching symptom in `detail` to find prior occurrences and how they were fixed.
3. **If a previous fix for this incident class failed, use extended reasoning.**
   Re-read every related log line end to end; explicitly state *why* the previous
   fix failed; form a **different** hypothesis (do not retry the same fix); reason
   step by step before editing any code.
4. **Add regression tests.** Write a Vitest `*.test.ts` that fails on the bug and
   passes after the fix, so this incident cannot silently recur.
5. **Verify before commit.** Run `npm run typecheck && npm run test`, and exercise
   the live loop where relevant. Only commit when everything is green.

## Guardrails

- This repo currently lives inside the larger `/mnt/c/Users/ayush` git repo (the
  home directory). Scope all git operations to `project-sentinel/`.
- Do not hand-edit `docs/incident-history.log` — it is append-only and written by
  `incident-recorder`. `.gitignore` keeps it tracked while ignoring other `*.log`.
- `.chaos-backups/` holds reversible mutation-test state and should be gitignored.
