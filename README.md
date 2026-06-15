# Project Sentinel

A resilience-engineering monorepo. Sentinel deliberately breaks things, watches
how the system reacts, and keeps a durable record of every incident.

## Data flow

```
scripts/chaos-monkey  ──inject fault──►  services/health-monitor
                                               │
                                       detects failure
                                               │
                                               ▼
                                   services/incident-recorder
                                               │
                                       appends record
                                               ▼
                                   docs/incident-history.log
                                               ▲
                                               │ reads & displays
                                          app (Next.js dashboard)
```

## Workspaces

| Path                          | Stack            | Purpose                                            |
| ----------------------------- | ---------------- | -------------------------------------------------- |
| `app/`                        | Next.js + TS     | Dashboard showing live service health & incidents  |
| `services/health-monitor/`    | Node.js + TS     | Polls targets, accepts fault injection, raises incidents |
| `services/incident-recorder/` | Node.js + TS     | Receives incidents, appends to the history log     |
| `scripts/`                    | Node.js + TS     | Chaos Monkey — injects random faults               |
| `docs/`                       | —                | `incident-history.log`, the canonical incident record |

## Quick start

```bash
npm install

# Terminal 1 — start the microservices
npm run dev:services

# Terminal 2 — start the dashboard (http://localhost:3000)
npm run dev:app

# Terminal 3 — unleash chaos
npm run chaos
```

## Ports

| Service             | Port | Env var          |
| ------------------- | ---- | ---------------- |
| app (dashboard)     | 3000 | —                |
| health-monitor      | 4001 | `MONITOR_PORT`   |
| incident-recorder   | 4002 | `RECORDER_PORT`  |
