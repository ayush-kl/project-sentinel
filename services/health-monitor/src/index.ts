import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openIncidents, type RawIncident } from "./incidents.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
// services/error.log collects service-level errors for offline analysis.
const ERROR_LOG = resolve(__dirname, "../../error.log");

/** Best-effort: append a service-level error to services/error.log. */
async function logError(service: string, message: string): Promise<void> {
  const line = `${new Date().toISOString()} [ERROR] ${service} :: ${message}\n`;
  try {
    await appendFile(ERROR_LOG, line, "utf8");
  } catch {
    /* never let logging crash the caller */
  }
}

const PORT = Number(process.env.MONITOR_PORT ?? 4001);
const RECORDER_URL = process.env.RECORDER_URL ?? "http://localhost:4002";
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS ?? 5000);
// MCP status is polled less often — `claude mcp list` spawns subprocesses.
const MCP_CHECK_INTERVAL_MS = Number(process.env.MCP_CHECK_INTERVAL_MS ?? 30000);
const MCP_MONITOR = process.env.MCP_MONITOR !== "off";

interface Target {
  name: string;
  up: boolean;
  lastChecked: string;
  // When the chaos monkey injects a fault, the target is forced DOWN until
  // this timestamp. null means "healthy / recovered".
  faultUntil: number | null;
}

const targets = new Map<string, Target>([
  ["payments-api", { name: "payments-api", up: true, lastChecked: "", faultUntil: null }],
  ["auth-api", { name: "auth-api", up: true, lastChecked: "", faultUntil: null }],
  ["search-api", { name: "search-api", up: true, lastChecked: "", faultUntil: null }],
]);

async function raiseIncident(
  service: string,
  severity: "INFO" | "WARN" | "CRITICAL",
  detail: string,
): Promise<void> {
  try {
    await fetch(`${RECORDER_URL}/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service, severity, detail }),
    });
  } catch (err) {
    console.error(`[health-monitor] failed to record incident:`, err);
    void logError("health-monitor", `failed to record incident for ${service}: ${String(err)}`);
  }
}

/** One monitoring sweep: evaluate every target and emit incidents on edges. */
function sweep(): void {
  const now = Date.now();
  for (const t of targets.values()) {
    const wasUp = t.up;
    const isUp = t.faultUntil === null || now >= t.faultUntil;
    t.up = isUp;
    t.lastChecked = new Date(now).toISOString();

    if (isUp) t.faultUntil = null;

    if (wasUp && !isUp) {
      void raiseIncident(t.name, "CRITICAL", "health check failed — target is DOWN");
    } else if (!wasUp && isUp) {
      void raiseIncident(t.name, "INFO", "target recovered — health check passing");
    }
  }
}

/**
 * Self-heal orphaned incidents on boot. Target up/down state lives only in
 * memory, so if the monitor is killed while an incident is open the DOWN→UP edge
 * is lost and the incident stays "active" forever. On startup we ask the recorder
 * which incidents are still open and, for any target we currently observe as
 * healthy, write the missing recovery line so the dashboard can close it.
 *
 * Idempotent: the recovery INFO becomes the latest event for that service, so a
 * later restart computes it as closed and emits nothing.
 */
async function reconcileOnStartup(): Promise<void> {
  try {
    const res = await fetch(`${RECORDER_URL}/incidents?limit=200`);
    if (!res.ok) throw new Error(`recorder responded ${res.status}`);
    const { incidents } = (await res.json()) as { incidents: RawIncident[] };
    const open = openIncidents(incidents);

    for (const t of targets.values()) {
      if (t.up && open.has(t.name)) {
        void raiseIncident(
          t.name,
          "INFO",
          "reconciled on startup — target healthy, closing stale incident",
        );
      }
    }
  } catch (err) {
    console.error("[health-monitor] startup reconciliation failed:", err);
    void logError("health-monitor", `startup reconciliation failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// MCP server monitoring — shells out to `claude mcp list` and parses the result.
// ---------------------------------------------------------------------------
interface McpServer {
  name: string;
  command: string;
  connected: boolean;
  detail: string;
}

let mcpServers: McpServer[] = [];
let mcpCheckedAt = "";
let mcpAvailable = MCP_MONITOR;
// Previous connectivity per server, used to emit incidents only on edges.
const mcpPrev = new Map<string, boolean>();
let mcpInitialized = false;

const ANSI_RE = /\[[0-9;]*m/g;

/** Parse the output of `claude mcp list` into structured server statuses. */
export function parseMcpList(raw: string): McpServer[] {
  const servers: McpServer[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(ANSI_RE, "").trim();
    // e.g. "github: npx -y @modelcontextprotocol/server-github - ✔ Connected"
    const m = /^([A-Za-z0-9_.-]+):\s+(.*?)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const [, name, command, status] = m;
    const connected = /connected/i.test(status!) && !/fail/i.test(status!);
    servers.push({
      name: name!,
      command: command!,
      connected,
      detail: status!.replace(/^[^A-Za-z]+/, "").trim(),
    });
  }
  return servers;
}

async function checkMcp(): Promise<void> {
  if (!MCP_MONITOR) return;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("claude", ["mcp", "list"], {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    }));
  } catch (err) {
    // `claude mcp list` exits non-zero when a server is unhealthy, but still
    // prints the table to stdout — recover it from the error when present.
    const out = (err as { stdout?: string }).stdout;
    if (typeof out === "string" && out.length > 0) {
      stdout = out;
    } else {
      mcpAvailable = false;
      mcpCheckedAt = new Date().toISOString();
      console.error("[health-monitor] mcp check failed (claude CLI unavailable?):", err);
      void logError("health-monitor", `mcp check failed: ${String(err)}`);
      return;
    }
  }

  mcpAvailable = true;
  mcpServers = parseMcpList(stdout);
  mcpCheckedAt = new Date().toISOString();

  for (const s of mcpServers) {
    const prev = mcpPrev.get(s.name);
    mcpPrev.set(s.name, s.connected);
    // Only raise after the first sweep, so we report transitions not boot state.
    if (!mcpInitialized || prev === undefined || prev === s.connected) continue;
    if (s.connected) {
      void raiseIncident(`mcp:${s.name}`, "INFO", `MCP server reconnected — ${s.detail}`);
    } else {
      void raiseIncident(`mcp:${s.name}`, "CRITICAL", `MCP server disconnected — ${s.detail}`);
    }
  }
  mcpInitialized = true;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  const list = [...targets.values()].map(({ name, up, lastChecked }) => ({
    name,
    up,
    lastChecked,
  }));
  const allUp = list.every((t) => t.up);
  res.json({ status: allUp ? "healthy" : "degraded", targets: list });
});

// MCP server connectivity, refreshed on MCP_CHECK_INTERVAL_MS.
app.get("/mcp", (_req, res) => {
  res.json({
    enabled: MCP_MONITOR,
    available: mcpAvailable,
    checkedAt: mcpCheckedAt,
    servers: mcpServers,
  });
});

// Fault-injection endpoint used by scripts/chaos-monkey.
app.post("/chaos/inject", (req, res) => {
  const { target, durationMs } = req.body ?? {};
  const t = targets.get(target);
  if (!t) {
    return res.status(404).json({ error: `unknown target: ${target}` });
  }
  const duration = Number(durationMs) || 8000;
  t.faultUntil = Date.now() + duration;
  console.log(`[health-monitor] fault injected into ${target} for ${duration}ms`);
  res.status(202).json({ injected: target, durationMs: duration });
});

app.listen(PORT, () => {
  console.log(`[health-monitor] listening on :${PORT}, sweeping every ${CHECK_INTERVAL_MS}ms`);
  setInterval(sweep, CHECK_INTERVAL_MS);
  sweep();
  // After the first sweep `t.up` reflects current health; reconcile any
  // incidents orphaned by a previous crash.
  void reconcileOnStartup();

  if (MCP_MONITOR) {
    console.log(`[health-monitor] polling MCP status every ${MCP_CHECK_INTERVAL_MS}ms`);
    setInterval(() => void checkMcp(), MCP_CHECK_INTERVAL_MS);
    void checkMcp();
  }
});
