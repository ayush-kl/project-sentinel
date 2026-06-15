/**
 * Pure incident-pairing logic, extracted so it can be unit-tested in isolation.
 *
 * Mirrors `classify()` in `app/src/lib/sentinel.ts`: a non-INFO severity
 * (CRITICAL/WARN) opens (or keeps open) an incident for a service, and an INFO
 * for the same service closes it. The recorder's `GET /incidents` returns
 * newest-first, so callers must pass the raw list and we walk it chronologically
 * (oldest → newest) here.
 */

export interface RawIncident {
  time: string;
  service: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  detail: string;
}

/**
 * Given the recorder's newest-first incident list, return the set of service
 * names whose latest state is an unresolved (still-open) incident. Pure: no I/O,
 * no side effects.
 */
export function openIncidents(raw: RawIncident[]): Set<string> {
  // The recorder returns newest-first; walk oldest-first to pair down/up edges.
  const chrono = [...raw].reverse();
  const open = new Set<string>();

  for (const r of chrono) {
    if (r.severity === "INFO") {
      open.delete(r.service);
    } else {
      open.add(r.service);
    }
  }

  return open;
}
