/**
 * Server-side data access for the dashboard. Reads from the existing Sentinel
 * services (health-monitor and incident-recorder) over HTTP and derives the
 * view models the pages need. All functions degrade to `null` if a service is
 * unreachable so pages can render a graceful "offline" state.
 */

const MONITOR_URL = process.env.MONITOR_URL ?? "http://localhost:4001";
const RECORDER_URL = process.env.RECORDER_URL ?? "http://localhost:4002";

export type Severity = "INFO" | "WARN" | "CRITICAL";

export interface RawIncident {
  time: string;
  service: string;
  severity: Severity;
  detail: string;
}

export interface DerivedIncident extends RawIncident {
  id: string;
  status: "active" | "resolved";
  resolvedByClaude: boolean;
  resolvedAt?: string;
  resolution?: string;
}

export interface HealthTarget {
  name: string;
  up: boolean;
  lastChecked: string;
}

export interface SystemHealth {
  status: string;
  targets: HealthTarget[];
}

export interface McpServer {
  name: string;
  command: string;
  connected: boolean;
  detail: string;
}

export interface McpStatus {
  enabled: boolean;
  available: boolean;
  checkedAt: string;
  servers: McpServer[];
}

/**
 * An incident is "resolved" when a later INFO line for the same service reports
 * recovery. We attribute it to Claude when that resolving line mentions Claude
 * (the Resolution Protocol appends e.g. "resolved by Claude: ..."). Auto-recovery
 * lines simply close the incident without Claude attribution.
 */
export function classify(raw: RawIncident[]): DerivedIncident[] {
  // The recorder returns newest-first; walk oldest-first to pair down/up edges.
  const chrono = [...raw].reverse();
  const openByService = new Map<string, DerivedIncident>();
  const incidents: DerivedIncident[] = [];

  chrono.forEach((r, i) => {
    if (r.severity === "INFO") {
      const open = openByService.get(r.service);
      if (open) {
        open.status = "resolved";
        open.resolvedAt = r.time;
        open.resolution = r.detail;
        open.resolvedByClaude = /claude/i.test(r.detail);
        openByService.delete(r.service);
      }
      return;
    }

    // A repeated CRITICAL/WARN while an incident is already open for this
    // service is a continuation of the same outage, not a new incident.
    // (Mirrors openIncidents() in services/health-monitor/src/incidents.ts.)
    if (openByService.has(r.service)) return;

    const incident: DerivedIncident = {
      ...r,
      id: `${r.time}-${i}`,
      status: "active",
      resolvedByClaude: false,
    };
    incidents.push(incident);
    openByService.set(r.service, incident);
  });

  // Newest-first for display.
  return incidents.reverse();
}

export async function getIncidents(): Promise<DerivedIncident[] | null> {
  try {
    const res = await fetch(`${RECORDER_URL}/incidents?limit=200`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`recorder responded ${res.status}`);
    const data = (await res.json()) as { incidents: RawIncident[] };
    return classify(data.incidents);
  } catch {
    return null;
  }
}

export async function getActiveIncidents(): Promise<DerivedIncident[] | null> {
  const all = await getIncidents();
  return all && all.filter((i) => i.status === "active");
}

export async function getClaudeResolved(): Promise<DerivedIncident[] | null> {
  const all = await getIncidents();
  return all && all.filter((i) => i.status === "resolved" && i.resolvedByClaude);
}

export async function getSystemHealth(): Promise<SystemHealth | null> {
  try {
    const res = await fetch(`${MONITOR_URL}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error(`monitor responded ${res.status}`);
    return (await res.json()) as SystemHealth;
  } catch {
    return null;
  }
}

export type SystemStatusValue =
  | "operational"
  | "investigating"
  | "degraded"
  | "maintenance";

export interface SystemStatusInfo {
  status: SystemStatusValue;
  note: string;
  updatedAt: string;
}

export async function getSystemStatus(): Promise<SystemStatusInfo | null> {
  try {
    const res = await fetch(`${RECORDER_URL}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`recorder responded ${res.status}`);
    return (await res.json()) as SystemStatusInfo;
  } catch {
    return null;
  }
}

export async function getMcpStatus(): Promise<McpStatus | null> {
  try {
    const res = await fetch(`${MONITOR_URL}/mcp`, { cache: "no-store" });
    if (!res.ok) throw new Error(`monitor responded ${res.status}`);
    return (await res.json()) as McpStatus;
  } catch {
    return null;
  }
}
