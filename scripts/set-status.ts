/**
 * set-status — update the dashboard status via incident-recorder.
 *
 * Usage:
 *   tsx set-status.ts <status> [note...]
 *   tsx set-status.ts investigating "analyzing services/error.log"
 *
 * Valid statuses: operational | investigating | degraded | maintenance
 *
 * This is the hook a headless run can call, e.g.:
 *   cat services/error.log | claude -p "Analyze this, then run
 *     'npm run status -- investigating <summary>'"
 *
 * Env: RECORDER_URL (default http://localhost:4002)
 */

const RECORDER_URL = process.env.RECORDER_URL ?? "http://localhost:4002";
const VALID = ["operational", "investigating", "degraded", "maintenance"];

async function main(): Promise<void> {
  const [status, ...noteParts] = process.argv.slice(2);
  const note = noteParts.join(" ");

  if (!status || !VALID.includes(status)) {
    console.error(`Usage: set-status <${VALID.join("|")}> [note]`);
    process.exit(1);
  }

  try {
    const res = await fetch(`${RECORDER_URL}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note }),
    });
    if (!res.ok) {
      console.error(`Failed: recorder responded ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const body = (await res.json()) as { status: string; note?: string };
    console.log(`✅ dashboard status → ${body.status}${body.note ? ` (${body.note})` : ""}`);
  } catch (err) {
    console.error(`Failed to reach incident-recorder at ${RECORDER_URL}:`, err);
    process.exit(1);
  }
}

void main();

// Mark this file as a module so its top-level symbols don't collide with the
// other script files compiled together by scripts/tsconfig.json.
export {};
