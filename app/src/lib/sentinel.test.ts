import { describe, it, expect } from "vitest";
import { classify, type RawIncident } from "./sentinel";

/**
 * Regression coverage for the dashboard's incident derivation. Mirrors the
 * "orphaned incident" fix in the health-monitor: an unrecovered CRITICAL must
 * surface as `active`, while a later INFO recovery must flip it to `resolved`.
 * Claude attribution is driven solely by the resolving line's `detail`.
 *
 * IMPORTANT: input is NEWEST-FIRST, as the recorder's /incidents returns it.
 */

const incident = (
  service: string,
  severity: RawIncident["severity"],
  detail = "",
  time = "2026-06-15T00:00:00.000Z",
): RawIncident => ({ time, service, severity, detail });

describe("classify", () => {
  it("marks a CRITICAL with no recovery as active", () => {
    const raw: RawIncident[] = [
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const [derived] = classify(raw);

    expect(derived?.status).toBe("active");
    expect(derived?.resolvedByClaude).toBe(false);
    expect(derived?.resolvedAt).toBeUndefined();
  });

  it("marks a CRITICAL followed by an INFO recovery as resolved", () => {
    const raw: RawIncident[] = [
      incident("api", "INFO", "target recovered", "2026-06-15T10:05:00.000Z"),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const [derived] = classify(raw);

    expect(derived?.status).toBe("resolved");
    expect(derived?.resolvedAt).toBe("2026-06-15T10:05:00.000Z");
    expect(derived?.resolution).toBe("target recovered");
  });

  it("sets resolvedByClaude when the recovery detail mentions Claude", () => {
    const raw: RawIncident[] = [
      incident(
        "api",
        "INFO",
        "resolved by Claude: restarted upstream",
        "2026-06-15T10:05:00.000Z",
      ),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const [derived] = classify(raw);

    expect(derived?.status).toBe("resolved");
    expect(derived?.resolvedByClaude).toBe(true);
  });

  it("leaves resolvedByClaude false for a generic auto-recovery", () => {
    const raw: RawIncident[] = [
      incident("api", "INFO", "target recovered", "2026-06-15T10:05:00.000Z"),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const [derived] = classify(raw);

    expect(derived?.status).toBe("resolved");
    expect(derived?.resolvedByClaude).toBe(false);
  });

  it("collapses repeated CRITICALs into one incident that resolves on recovery", () => {
    // Two consecutive CRITICALs (no INFO between) then one recovery — as the
    // chaos run produced. The earlier CRITICAL must NOT linger as a phantom
    // active incident; the whole outage resolves. Regression for the classify()
    // open-map overwrite bug (must agree with openIncidents()).
    const raw: RawIncident[] = [
      incident("api", "INFO", "target recovered", "2026-06-15T10:09:00.000Z"),
      incident("api", "CRITICAL", "still down", "2026-06-15T10:05:00.000Z"),
      incident("api", "CRITICAL", "target down", "2026-06-15T10:00:00.000Z"),
    ];

    const derived = classify(raw);

    expect(derived).toHaveLength(1);
    expect(derived[0]?.status).toBe("resolved");
    expect(derived.filter((d) => d.status === "active")).toHaveLength(0);
  });
});
