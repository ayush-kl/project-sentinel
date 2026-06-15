import { describe, it, expect } from "vitest";
import { openIncidents, type RawIncident } from "./incidents.js";

/**
 * Regression coverage for the "orphaned incident" bug: the health-monitor could
 * leave an incident permanently active if it was killed while the incident was
 * open. On restart it re-seeded targets as `up` and never wrote the DOWN→UP
 * recovery line. The fix added startup reconciliation, driven by `openIncidents`,
 * which derives the still-open set from the recorder's history.
 *
 * IMPORTANT: the recorder returns history NEWEST-FIRST, so every input below is
 * ordered newest → oldest, exactly as a caller receives it.
 */

const incident = (
  service: string,
  severity: RawIncident["severity"],
  detail = "",
  time = "2026-06-15T00:00:00.000Z",
): RawIncident => ({ time, service, severity, detail });

describe("openIncidents", () => {
  it("keeps a service open when a CRITICAL has no later INFO (orphaned-incident regression)", () => {
    // Newest-first: just the CRITICAL, never recovered. This is precisely the
    // state a killed monitor leaves behind; reconciliation must see it as open.
    const raw: RawIncident[] = [
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const open = openIncidents(raw);

    expect(open.has("api")).toBe(true);
    expect(open.size).toBe(1);
  });

  it("closes a service when a CRITICAL is followed by a later INFO recovery", () => {
    // Newest-first: INFO recovery (newest) then the CRITICAL (older).
    const raw: RawIncident[] = [
      incident("api", "INFO", "target recovered", "2026-06-15T10:05:00.000Z"),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const open = openIncidents(raw);

    expect(open.has("api")).toBe(false);
    expect(open.size).toBe(0);
  });

  it("treats a reconciliation INFO as a close, so reconciliation is idempotent", () => {
    // Once startup reconciliation has written its recovery INFO, a subsequent
    // restart must NOT see the service as open (else it would re-emit forever).
    const raw: RawIncident[] = [
      incident(
        "api",
        "INFO",
        "reconciled on startup: target recovered",
        "2026-06-15T11:00:00.000Z",
      ),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const open = openIncidents(raw);

    expect(open.has("api")).toBe(false);
    expect(open.size).toBe(0);
  });

  it("opens an incident for a WARN and closes it on a later INFO", () => {
    const raw: RawIncident[] = [
      incident("api", "INFO", "target recovered", "2026-06-15T10:05:00.000Z"),
      incident("api", "WARN", "elevated latency", "2026-06-15T10:00:00.000Z"),
    ];

    expect(openIncidents(raw).has("api")).toBe(false);

    // A lone WARN with no recovery stays open.
    const stillOpen = openIncidents([
      incident("api", "WARN", "elevated latency", "2026-06-15T10:00:00.000Z"),
    ]);
    expect(stillOpen.has("api")).toBe(true);
  });

  it("tracks multiple services independently", () => {
    // Newest-first across services: api recovered, db still down, system fine.
    const raw: RawIncident[] = [
      incident("db", "CRITICAL", "connection refused", "2026-06-15T10:30:00.000Z"),
      incident("system", "INFO", "boot complete", "2026-06-15T10:20:00.000Z"),
      incident("api", "INFO", "target recovered", "2026-06-15T10:15:00.000Z"),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const open = openIncidents(raw);

    expect(open.has("db")).toBe(true);
    expect(open.has("api")).toBe(false);
    expect(open.has("system")).toBe(false);
    expect(open.size).toBe(1);
  });

  it("returns an empty set for empty input", () => {
    expect(openIncidents([]).size).toBe(0);
  });
});
