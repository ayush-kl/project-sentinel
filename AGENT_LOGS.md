# AGENT_LOGS.md — Project Sentinel Resolution Session

> Chronological execution log of a multi-agent incident resolution on Project
> Sentinel. Reconstructed from `docs/incident-history.log`, the committed source,
> the colocated regression tests, and a live re-run of the verification gates.
> Incident class: **orphaned (permanently-active) incident** in `health-monitor`.

---

## 0. Context

Project Sentinel is a closed-loop resilience platform (npm workspaces):

```
chaos-monkey ──inject──► health-monitor ──incident──► incident-recorder ──append──► incident-history.log
                              ▲                                                              │
                              └──────────────────────  app dashboard reads  ◄───────────────┘
```

- `services/health-monitor` (:4001) — sweeps targets, emits incidents on UP↔DOWN edges.
- `services/incident-recorder` (:4002) — append-only system of record (`docs/incident-history.log`).
- `app` (:3000) — Next.js dashboard rendering live health + incident history.

**Agents engaged this session**

| Role | Agent | Mandate |
| --- | --- | --- |
| Orchestrator | **Main Agent** (Plan Mode) | Triage, planning, delegation, final verification |
| Diagnosis & fix | **Debugger Agent** (`backend-debugger`) | Root-cause the failure, implement the minimal durable fix |
| Verification | **QA Agent** (`regression-test-engineer`) | Reproduce the bug in a test, lock the fix, guard recurrence |

---

## 1. Initial Incident

**Trigger** — observed in `docs/incident-history.log`:

```
2026-06-15T15:25:16.454Z [CRITICAL] auth-api      :: health check failed — target is DOWN
2026-06-15T15:25:18.258Z [CRITICAL] payments-api  :: health check failed — target is DOWN
2026-06-15T15:25:22.268Z [CRITICAL] search-api    :: health check failed — target is DOWN
...
2026-06-15T15:25:28.266Z [INFO]     auth-api      :: target recovered — health check passing
2026-06-15T15:25:30.270Z [INFO]     search-api    :: target recovered — health check passing
```

**Symptom.** `auth-api` and `search-api` logged matching `INFO` recovery lines and
cleared from the dashboard. **`payments-api` did not.** Its `CRITICAL` had no
paired recovery line, so the dashboard rendered `payments-api` as a *permanently
active* incident — even though the service was, by every other signal, healthy.

This is an **orphaned incident**: an outage that opens but can never close.

---

## 2. Plan Mode Strategy (Main Agent)

The Main Agent entered Plan Mode before touching code and laid out the path:

1. **Honor the Resolution Protocol.** Read `docs/incident-history.log` newest-first;
   grep prior incidents for the same `service` + symptom to check for a recurring class.
2. **Separate symptom from cause.** A stuck dashboard row is the symptom; the missing
   DOWN→UP edge is the suspected cause. Do not hand-edit the append-only log to "clear"
   it — that masks the defect and violates the guardrails.
3. **Delegate diagnosis** to the Debugger Agent (`backend-debugger`) for evidence-based
   root-cause analysis and a minimal fix aligned with CLAUDE.md.
4. **Delegate verification** to the QA Agent (`regression-test-engineer`) to write a
   failing-then-passing regression test before the fix is accepted.
5. **Gate on green.** No commit until `npm run typecheck && npm run test` pass.

**Delegation boundaries** were fixed up front: the Debugger owns `services/`, the QA
Agent owns `*.test.ts`, and the Main Agent owns triage, sequencing, and the final gate.

---

## 3. Main Agent Responsibilities

- Triaged the incident from the log and confirmed it matched a *recurring class*, not
  a one-off (`payments-api` had previously been closed manually:
  `16:04:19 [INFO] payments-api :: resolved by Claude — confirmed healthy; closing orphaned incident`).
- Produced the plan above and kept the two sub-agents inside their lanes.
- Enforced the guardrails: no hand-editing of `incident-history.log`; all git scoped to
  `project-sentinel/`; strict-TypeScript rules (no `any`, no `!`, no unjustified `@ts-ignore`).
- Ran the final verification gate and authored this log.

## 4. Debugger Agent Responsibilities (`backend-debugger`)

- Gathered evidence from `health-monitor/src/index.ts` and the incident history around
  the failure window.
- Traced the execution path through `sweep()` and the in-memory `targets` map.
- Formed and verified a single root-cause hypothesis (Section 6), rejecting the symptom-level
  "just write a recovery line for payments-api" non-fix.
- Implemented the minimal durable fix (Section 7) and extracted the pairing logic into a
  pure, testable unit so the QA Agent could lock it without standing up the HTTP services.
- Recorded the failure pattern to agent memory
  (`.claude/agent-memory/regression-test-engineer/fragile_areas.md` documents the class).

## 5. QA Agent Responsibilities (`regression-test-engineer`)

- Wrote a reproduction test that captures the exact orphaned state (a `CRITICAL` with no
  later `INFO`) and asserts it is seen as *open*.
- Added boundary/idempotency coverage so startup reconciliation cannot re-emit forever.
- Confirmed the test fails against the pre-fix behavior and passes against the fix.
- Matched project conventions exactly: Vitest, colocated `*.test.ts`, inputs ordered
  **newest-first** (the way `GET /incidents` actually returns them).

---

## 6. Root Cause Analysis

**Root cause: monitor target state is in-memory only, so a crash loses the DOWN→UP edge.**

`health-monitor` holds each target's up/down state in a `Map` that is re-seeded as
`up: true` on every process start:

```ts
// services/health-monitor/src/index.ts
const targets = new Map<string, Target>([
  ["payments-api", { name: "payments-api", up: true, /* ... */ faultUntil: null }],
  // ...
]);
```

Incidents are only emitted on a **transition**:

```ts
if (wasUp && !isUp)      raiseIncident(t.name, "CRITICAL", "health check failed — target is DOWN");
else if (!wasUp && isUp) raiseIncident(t.name, "INFO",     "target recovered — health check passing");
```

Sequence that orphans an incident:

1. `payments-api` goes DOWN → a `CRITICAL` is written (incident opens).
2. The monitor process is **killed/restarted while the incident is still open.**
3. On restart, `targets` re-seeds `payments-api` as `up: true`. The previous DOWN state
   is gone, so the next sweep computes `wasUp == isUp == true` — **no edge, no recovery
   `INFO` is ever written.**
4. The recorder's history therefore holds a `CRITICAL` with no closing `INFO`, and both
   `openIncidents()` (monitor) and `classify()` (dashboard) correctly report it as still
   active — forever.

The defect is **lost state across a restart**, not a parsing or display bug. The fix must
reconcile persisted history against live health at boot.

---

## 7. Fix Implemented

Two coordinated changes in `services/health-monitor/`:

**(a) Pure, unit-testable pairing logic — `src/incidents.ts`**

```ts
/** Service names whose latest state is still an open incident. Pure: no I/O. */
export function openIncidents(raw: RawIncident[]): Set<string> {
  const chrono = [...raw].reverse();          // recorder returns newest-first
  const open = new Set<string>();
  for (const r of chrono) {
    if (r.severity === "INFO") open.delete(r.service); // INFO closes
    else open.add(r.service);                          // CRITICAL/WARN opens
  }
  return open;
}
```

**(b) Startup reconciliation — `src/index.ts`**

```ts
async function reconcileOnStartup(): Promise<void> {
  const res = await fetch(`${RECORDER_URL}/incidents?limit=200`);
  const { incidents } = (await res.json()) as { incidents: RawIncident[] };
  const open = openIncidents(incidents);
  for (const t of targets.values()) {
    if (t.up && open.has(t.name)) {
      void raiseIncident(t.name, "INFO",
        "reconciled on startup — target healthy, closing stale incident");
    }
  }
}
```

It runs after the first sweep (so `t.up` reflects real health) and is **idempotent**: the
recovery `INFO` becomes the latest event for that service, so a later restart computes it as
closed and emits nothing.

**Live confirmation in the log** — the fix self-healed the next orphan:

```
2026-06-15T16:16:52.058Z [CRITICAL] search-api :: health check failed — target is DOWN
2026-06-15T16:17:09.386Z [INFO]     search-api :: reconciled on startup — target healthy, closing stale incident
```

The change followed CLAUDE.md: HTTP/JSON between services, `RECORDER_URL` from env, strict
TypeScript, no log hand-editing.

---

## 8. Regression Tests Added

`services/health-monitor/src/incidents.test.ts` — 6 Vitest cases, colocated, newest-first inputs:

| Test | Guards |
| --- | --- |
| keeps a service open when a `CRITICAL` has no later `INFO` | **the core orphaned-incident bug** |
| closes a service when a `CRITICAL` is followed by a later `INFO` | normal recovery path |
| treats a reconciliation `INFO` as a close | **idempotency** — restart won't re-emit |
| opens on `WARN`, closes on later `INFO`; lone `WARN` stays open | severity handling |
| tracks multiple services independently | blast-radius / cross-talk |
| returns an empty set for empty input | boundary |

Mirror coverage for the dashboard's `classify()` lives in `app/src/lib/sentinel.test.ts`
(5 cases). The duplicated pairing logic in the two files is flagged to be changed together
(`.claude/agent-memory/regression-test-engineer/fragile_areas.md`).

---

## 9. Verification Results

Re-run at session close from the repo root:

**`npm run typecheck`** — clean across all four workspaces:

```
app@0.1.0 typecheck                     tsc --noEmit   ✓
@sentinel/health-monitor typecheck      tsc --noEmit   ✓
@sentinel/incident-recorder typecheck   tsc --noEmit   ✓
@sentinel/scripts typecheck             tsc --noEmit   ✓
```

**`npm run test`** — 11 tests passing, 0 failing:

```
app                  src/lib/sentinel.test.ts     5 passed (5)
@sentinel/health-monitor  src/incidents.test.ts   6 passed (6)
```

**Live loop** — startup reconciliation observed closing the `search-api` orphan in
`docs/incident-history.log` (Section 7).

---

## 10. Final Outcome

✅ **Resolved.** The orphaned-incident class is eliminated at the source.

- **Root cause** identified: in-memory monitor state lost the DOWN→UP edge across restarts.
- **Durable fix** shipped: boot-time reconciliation reconciles recorder history against live
  health and self-closes stale incidents; idempotent by construction.
- **Regression coverage** locks the bug and its idempotency so it cannot silently return.
- **Gates green:** typecheck clean (4 workspaces), 11/11 tests passing, behavior confirmed in
  the live feedback loop.
- **Institutional memory** updated so future sessions treat this as a known, guarded class.

**Verification gate satisfied:** `npm run typecheck && npm run test` → green.
