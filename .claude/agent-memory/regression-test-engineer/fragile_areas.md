---
name: fragile-areas
description: Duplicated incident-pairing logic across health-monitor and app, and the orphaned-incident bug class to regression-guard
metadata:
  type: project
---

**Duplicated incident-pairing logic — keep both in sync.**
The DOWN→UP pairing walk exists in TWO places that mirror each other:
- `services/health-monitor/src/incidents.ts` → `openIncidents(raw)` returns the still-open service set.
- `app/src/lib/sentinel.ts` → `classify(raw)` derives `active`/`resolved` + `resolvedByClaude`.

Both take the recorder's **newest-first** list and `.reverse()` to walk oldest→newest. Non-INFO (CRITICAL/WARN) opens; INFO closes. `resolvedByClaude` = `/claude/i.test(detail)` on the resolving INFO line. A change to one almost certainly needs the matching change to the other — regression-test both together.

**Why:** When testing these, always pass inputs NEWEST-FIRST (the way `GET /incidents` returns them). Getting the order wrong makes tests pass for the wrong reason.

**Orphaned-incident bug class (regression target):**
The health-monitor could leave an incident permanently active if killed while an incident was open — on restart it re-seeded targets `up` and never wrote the DOWN→UP recovery line. Fix = startup reconciliation driven by `openIncidents`. The guarding assertion: a CRITICAL with no later INFO must be in the open set / `status: "active"`. Also assert idempotency: a reconciliation INFO ("reconciled on startup …") closes the service so restart doesn't re-emit.

`classify()` was made `export`able (was module-private) purely to unit-test it — an acceptable minimal change.
