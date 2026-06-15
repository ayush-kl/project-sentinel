import express from "express";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RECORDER_PORT ?? 4002);

// docs/incident-history.log is the canonical, append-only record.
const LOG_PATH = resolve(__dirname, "../../../docs/incident-history.log");
// services/error.log collects service-level errors for offline analysis.
const ERROR_LOG = resolve(__dirname, "../../error.log");
// docs/system-status.json holds the single, mutable dashboard status.
const STATUS_PATH = resolve(__dirname, "../../../docs/system-status.json");

const SYSTEM_STATUSES = [
  "operational",
  "investigating",
  "degraded",
  "maintenance",
] as const;
type SystemStatusValue = (typeof SYSTEM_STATUSES)[number];

interface SystemStatus {
  status: SystemStatusValue;
  note: string;
  updatedAt: string;
}

const DEFAULT_STATUS: SystemStatus = {
  status: "operational",
  note: "",
  updatedAt: "",
};

type Severity = "INFO" | "WARN" | "CRITICAL";

interface Incident {
  time: string;
  service: string;
  severity: Severity;
  detail: string;
}

function formatLine(i: Incident): string {
  return `${i.time} [${i.severity}] ${i.service} :: ${i.detail}\n`;
}

/** Best-effort: append a service-level error to services/error.log. */
async function logError(service: string, message: string): Promise<void> {
  const line = `${new Date().toISOString()} [ERROR] ${service} :: ${message}\n`;
  try {
    await appendFile(ERROR_LOG, line, "utf8");
  } catch {
    /* never let logging crash the handler */
  }
}

async function readStatus(): Promise<SystemStatus> {
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SystemStatus>;
    if (parsed.status && SYSTEM_STATUSES.includes(parsed.status)) {
      return {
        status: parsed.status,
        note: parsed.note ?? "",
        updatedAt: parsed.updatedAt ?? "",
      };
    }
  } catch {
    /* missing/corrupt → fall through to default */
  }
  return DEFAULT_STATUS;
}

/** Parse the append-only log back into structured incidents (newest last). */
async function readIncidents(limit: number): Promise<Incident[]> {
  let raw: string;
  try {
    raw = await readFile(LOG_PATH, "utf8");
  } catch {
    return [];
  }

  const lineRe = /^(\S+) \[(INFO|WARN|CRITICAL)\] (\S+) :: (.*)$/;
  const incidents: Incident[] = [];
  for (const line of raw.split("\n")) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    incidents.push({
      time: m[1]!,
      severity: m[2] as Severity,
      service: m[3]!,
      detail: m[4]!,
    });
  }
  return incidents.slice(-limit).reverse();
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "incident-recorder" });
});

app.post("/incidents", async (req, res) => {
  const { service, severity, detail } = req.body ?? {};
  if (typeof service !== "string" || typeof detail !== "string") {
    return res.status(400).json({ error: "service and detail are required" });
  }
  const incident: Incident = {
    time: new Date().toISOString(),
    service,
    severity: (["INFO", "WARN", "CRITICAL"] as const).includes(severity)
      ? severity
      : "WARN",
    detail,
  };
  try {
    await appendFile(LOG_PATH, formatLine(incident), "utf8");
  } catch (err) {
    await logError("incident-recorder", `failed to persist incident: ${String(err)}`);
    return res.status(500).json({ error: "failed to persist incident" });
  }
  console.log(`recorded: ${formatLine(incident).trim()}`);
  res.status(201).json(incident);
});

app.get("/incidents", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
  res.json({ incidents: await readIncidents(limit) });
});

// Current dashboard status (single global value).
app.get("/status", async (_req, res) => {
  res.json(await readStatus());
});

// Update the dashboard status, e.g. to "investigating". Also records an
// audit incident so the change shows up in the history feed.
app.post("/status", async (req, res) => {
  const { status, note } = req.body ?? {};
  if (!SYSTEM_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${SYSTEM_STATUSES.join(", ")}`,
    });
  }
  const next: SystemStatus = {
    status,
    note: typeof note === "string" ? note : "",
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeFile(STATUS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch (err) {
    await logError("incident-recorder", `failed to write status: ${String(err)}`);
    return res.status(500).json({ error: "failed to write status" });
  }
  const severity: Severity = status === "operational" ? "INFO" : "WARN";
  const detail = `dashboard status set to ${status}${next.note ? ` — ${next.note}` : ""}`;
  await appendFile(LOG_PATH, formatLine({ time: next.updatedAt, service: "system", severity, detail }), "utf8").catch(
    (err) => logError("incident-recorder", `failed to record status change: ${String(err)}`),
  );
  console.log(`status: ${detail}`);
  res.status(200).json(next);
});

app.listen(PORT, () => {
  console.log(`[incident-recorder] listening on :${PORT} → ${LOG_PATH}`);
});
