# Architecture

Project Sentinel is a small resilience-engineering platform composed of four
workspaces that form a closed feedback loop.

## Components

### `scripts/chaos-monkey.ts`
The fault generator. On an interval it picks a random target service and calls
`health-monitor`'s `POST /chaos/inject` endpoint, knocking that target offline
for a randomized duration.

### `services/health-monitor` (port 4001)
Maintains the live state of every monitored target. A timer "sweeps" all targets
on a fixed cadence (`CHECK_INTERVAL_MS`). When a target transitions UP→DOWN or
DOWN→UP, the monitor POSTs an incident to `incident-recorder`.

- `GET  /health` — current status of all targets (consumed by the dashboard)
- `POST /chaos/inject` — fault-injection hook used by the chaos monkey

### `services/incident-recorder` (port 4002)
The system of record. Accepts incidents and appends them to
`docs/incident-history.log`, the single canonical, append-only history.

- `POST /incidents` — record one incident
- `GET  /incidents?limit=N` — read back the most recent N incidents

### `app` (port 3000)
A Next.js dashboard. Server components fetch `/health` from the monitor and
`/incidents` from the recorder and render them. If a service is unreachable the
dashboard degrades gracefully rather than crashing.

## Feedback loop

```
chaos-monkey ──inject──► health-monitor ──incident──► incident-recorder ──append──► incident-history.log
                              ▲                                                              │
                              └──────────────────────  app dashboard reads  ◄───────────────┘
```

## Conventions

- Inter-service communication is plain HTTP/JSON; URLs are injected via env vars
  (`MONITOR_URL`, `RECORDER_URL`) so services can be relocated without code changes.
- The log line format is fixed and parsed with a regex in `incident-recorder`;
  changing the format means updating both the writer and the parser.
