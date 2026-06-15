/**
 * Chaos Monkey
 * ------------
 * Periodically picks a random target and injects a fault into the
 * health-monitor service. The monitor then detects the outage and reports it
 * to the incident-recorder, which writes to docs/incident-history.log.
 *
 * Usage:
 *   npm run chaos                 # run forever, default cadence
 *   MONITOR_URL=... npm run chaos
 *
 * Env:
 *   MONITOR_URL        default http://localhost:4001
 *   CHAOS_INTERVAL_MS  default 12000  (time between attacks)
 *   CHAOS_MIN_FAULT_MS default 6000   (shortest outage)
 *   CHAOS_MAX_FAULT_MS default 15000  (longest outage)
 *   CHAOS_ROUNDS       default 0      (0 = run indefinitely)
 */

const MONITOR_URL = process.env.MONITOR_URL ?? "http://localhost:4001";
const INTERVAL_MS = Number(process.env.CHAOS_INTERVAL_MS ?? 12000);
const MIN_FAULT_MS = Number(process.env.CHAOS_MIN_FAULT_MS ?? 6000);
const MAX_FAULT_MS = Number(process.env.CHAOS_MAX_FAULT_MS ?? 15000);
const ROUNDS = Number(process.env.CHAOS_ROUNDS ?? 0);

const TARGETS = ["payments-api", "auth-api", "search-api"];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attack(): Promise<void> {
  const target = pick(TARGETS);
  const durationMs = randomBetween(MIN_FAULT_MS, MAX_FAULT_MS);
  try {
    const res = await fetch(`${MONITOR_URL}/chaos/inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, durationMs }),
    });
    if (!res.ok) throw new Error(`monitor responded ${res.status}`);
    console.log(`🐒 injected fault → ${target} (down for ${durationMs}ms)`);
  } catch (err) {
    console.error(`🐒 attack failed (is health-monitor running at ${MONITOR_URL}?):`, err);
  }
}

async function main(): Promise<void> {
  console.log(`🐒 Chaos Monkey awake. Targeting ${MONITOR_URL} every ${INTERVAL_MS}ms.`);
  let round = 0;
  // Graceful shutdown on Ctrl-C.
  process.on("SIGINT", () => {
    console.log("\n🐒 Chaos Monkey going back to sleep.");
    process.exit(0);
  });

  while (ROUNDS === 0 || round < ROUNDS) {
    await attack();
    round += 1;
    if (ROUNDS !== 0 && round >= ROUNDS) break;
    await sleep(INTERVAL_MS);
  }
}

void main();
