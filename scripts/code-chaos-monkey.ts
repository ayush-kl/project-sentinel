/**
 * Code Chaos Monkey  (source-mutation variant)
 * --------------------------------------------
 * Deliberately introduces defects into the *source* of the target services so
 * you can verify that your build, type-checker, tests, and the Sentinel
 * monitoring loop actually catch breakage. This is mutation testing / chaos
 * engineering — NOT the runtime fault injector in chaos-monkey.ts.
 *
 * Defect types injected at random:
 *   1. Syntax errors     — remove a balancing bracket
 *   2. Type mismatches   — flip a TS type annotation (string<->number<->boolean)
 *   3. Logic errors      — flip an operator (===/!==, &&/||, >/<, +1/-1)
 *   4. Missing imports   — comment out an import line
 *   5. Corrupted JSON    — delete a structural character from a .json file
 *
 * SAFETY:
 *   - Only touches files under services/. Refuses anything else.
 *   - Dry-run by default. Pass --apply to actually write.
 *   - Backs up every file it mutates and writes a manifest so changes are
 *     fully reversible with `restore`.
 *
 * Usage:
 *   tsx code-chaos-monkey.ts                 # dry run, show what it WOULD do
 *   tsx code-chaos-monkey.ts --apply         # mutate (with backups)
 *   tsx code-chaos-monkey.ts --apply -n 3    # apply 3 random mutations
 *   tsx code-chaos-monkey.ts --kind syntax   # restrict to one defect type
 *   tsx code-chaos-monkey.ts restore         # revert the last run
 *
 * Flags:
 *   --apply            actually write changes (otherwise dry-run)
 *   -n, --count <N>    number of mutations to attempt (default 1)
 *   --kind <k>         syntax | type | logic | import | json (default: any)
 *   --seed <s>         deterministic RNG seed
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SERVICES_DIR = resolve(REPO_ROOT, "services");
const BACKUP_DIR = resolve(REPO_ROOT, ".chaos-backups");
const MANIFEST = join(BACKUP_DIR, "last-run.json");
const INCIDENT_LOG = resolve(REPO_ROOT, "docs", "incident-history.log");

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) so runs can be reproduced with --seed.
// ---------------------------------------------------------------------------
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const isRestore = argv[0] === "restore";
const apply = argv.includes("--apply");
const kindFlag = valueOf("--kind");
const seed = Number(valueOf("--seed") ?? Date.now()) >>> 0;
const count = Number(valueOf("-n") ?? valueOf("--count") ?? 1) || 1;
const rng = makeRng(seed);

function valueOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ---------------------------------------------------------------------------
// Guard: never operate outside services/
// ---------------------------------------------------------------------------
function assertInServices(absPath: string): void {
  const rel = relative(SERVICES_DIR, resolve(absPath));
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) {
    throw new Error(`refusing to touch path outside services/: ${absPath}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

interface MutationResult {
  content: string;
  detail: string;
}

type Mutator = (content: string, file: string) => MutationResult | null;

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

// 1. Syntax error: remove a random balancing bracket.
const syntaxMutator: Mutator = (content) => {
  const positions: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "}" || c === ")" || c === "]") positions.push(i);
  }
  if (positions.length === 0) return null;
  const at = pick(positions);
  const removed = content[at];
  return {
    content: content.slice(0, at) + content.slice(at + 1),
    detail: `syntax error — removed a '${removed}' at offset ${at}`,
  };
};

// 2. Type mismatch: flip a TS type annotation.
const TYPE_FLIPS: Array<[RegExp, string]> = [
  [/:\s*string\b/, ": number"],
  [/:\s*number\b/, ": string"],
  [/:\s*boolean\b/, ": number"],
];
const typeMutator: Mutator = (content, file) => {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) return null;
  for (const [re, replacement] of shuffle(TYPE_FLIPS)) {
    const m = re.exec(content);
    if (m) {
      const at = m.index;
      return {
        content: content.slice(0, at) + replacement + content.slice(at + m[0].length),
        detail: `type mismatch — '${m[0].trim()}' -> '${replacement.trim()}'`,
      };
    }
  }
  return null;
};

// 3. Logic error: flip an operator.
const LOGIC_FLIPS: Array<[string, string]> = [
  ["===", "!=="],
  ["!==", "==="],
  [" && ", " || "],
  [" || ", " && "],
  [" >= ", " <= "],
  [" <= ", " >= "],
  ["+ 1", "- 1"],
];
const logicMutator: Mutator = (content) => {
  for (const [from, to] of shuffle(LOGIC_FLIPS)) {
    const idx = content.indexOf(from);
    if (idx >= 0) {
      return {
        content: content.slice(0, idx) + to + content.slice(idx + from.length),
        detail: `logic error — '${from.trim()}' -> '${to.trim()}'`,
      };
    }
  }
  return null;
};

// 4. Missing import: comment out an import statement.
const importMutator: Mutator = (content) => {
  const lines = content.split("\n");
  const importLines = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /^\s*import\b/.test(l));
  if (importLines.length === 0) return null;
  const { l, i } = pick(importLines);
  lines[i] = `// [chaos:missing-import] ${l}`;
  return {
    content: lines.join("\n"),
    detail: `missing import — commented out: ${l.trim()}`,
  };
};

// 5. Corrupted JSON: delete a structural character.
const jsonMutator: Mutator = (content, file) => {
  if (!file.endsWith(".json")) return null;
  const positions: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"' || c === "{" || c === "}" || c === ":" || c === ",") positions.push(i);
  }
  if (positions.length === 0) return null;
  const at = pick(positions);
  const removed = content[at];
  return {
    content: content.slice(0, at) + content.slice(at + 1),
    detail: `corrupted JSON — deleted '${removed}' at offset ${at}`,
  };
};

const MUTATORS: Record<string, { mutate: Mutator; ext: (f: string) => boolean }> = {
  syntax: { mutate: syntaxMutator, ext: (f) => /\.(ts|tsx)$/.test(f) },
  type: { mutate: typeMutator, ext: (f) => /\.(ts|tsx)$/.test(f) },
  logic: { mutate: logicMutator, ext: (f) => /\.(ts|tsx)$/.test(f) },
  import: { mutate: importMutator, ext: (f) => /\.(ts|tsx)$/.test(f) },
  json: { mutate: jsonMutator, ext: (f) => /\.json$/.test(f) },
};

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------
interface BackupEntry {
  file: string; // absolute
  original: string; // original content
}

function recordIncident(detail: string): void {
  try {
    const line = `${new Date().toISOString()} [CRITICAL] code-chaos-monkey :: ${detail}\n`;
    const prev = existsSync(INCIDENT_LOG) ? readFileSync(INCIDENT_LOG, "utf8") : "";
    writeFileSync(INCIDENT_LOG, prev + line, "utf8");
  } catch {
    /* logging is best-effort */
  }
}

function doRestore(): void {
  if (!existsSync(MANIFEST)) {
    console.error("Nothing to restore — no manifest found at", MANIFEST);
    process.exit(1);
  }
  const entries: BackupEntry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  for (const e of entries) {
    assertInServices(e.file);
    writeFileSync(e.file, e.original, "utf8");
    console.log(`restored ${relative(REPO_ROOT, e.file)}`);
  }
  recordIncident(`restored ${entries.length} file(s) from backup`);
  console.log(`\n✅ Restored ${entries.length} file(s).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (isRestore) return doRestore();

  if (!existsSync(SERVICES_DIR)) {
    console.error("No services/ directory found at", SERVICES_DIR);
    process.exit(1);
  }
  if (kindFlag && !(kindFlag in MUTATORS)) {
    console.error(`Unknown --kind '${kindFlag}'. Choose: ${Object.keys(MUTATORS).join(", ")}`);
    process.exit(1);
  }

  const allFiles = walk(SERVICES_DIR).filter((f) => /\.(ts|tsx|json)$/.test(f));
  if (allFiles.length === 0) {
    console.error("No mutable files under services/.");
    process.exit(1);
  }

  console.log(`🐒 Code Chaos Monkey  (seed=${seed}, mode=${apply ? "APPLY" : "dry-run"})`);
  console.log(`   scope: ${relative(REPO_ROOT, SERVICES_DIR)}/  files: ${allFiles.length}\n`);

  const backups: BackupEntry[] = [];
  const mutatedThisRun = new Map<string, string>(); // file -> working content
  let succeeded = 0;

  for (let attempt = 0; attempt < count * 8 && succeeded < count; attempt++) {
    const kinds = kindFlag ? [kindFlag] : shuffle(Object.keys(MUTATORS));
    const kind = pick(kinds);
    const { mutate, ext } = MUTATORS[kind]!;

    const candidates = allFiles.filter(ext);
    if (candidates.length === 0) continue;
    const file = pick(candidates);
    assertInServices(file);

    const current = mutatedThisRun.get(file) ?? readFileSync(file, "utf8");
    const result = mutate(current, file);
    if (!result) continue;

    console.log(`  • [${kind}] ${relative(REPO_ROOT, file)}`);
    console.log(`      ${result.detail}`);

    if (apply) {
      if (!mutatedThisRun.has(file)) {
        backups.push({ file, original: readFileSync(file, "utf8") });
      }
      mutatedThisRun.set(file, result.content);
      writeFileSync(file, result.content, "utf8");
      recordIncident(`[${kind}] ${relative(REPO_ROOT, file)} :: ${result.detail}`);
    }
    succeeded++;
  }

  if (succeeded === 0) {
    console.log("No applicable mutation found. Try a different --kind or seed.");
    return;
  }

  if (apply) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify(backups, null, 2), "utf8");
    console.log(`\n💾 Backed up ${backups.length} file(s). Revert with:`);
    console.log(`     tsx code-chaos-monkey.ts restore`);
    console.log(`⚠️  ${succeeded} defect(s) injected into services/.`);
  } else {
    console.log(`\n(dry run — nothing written. Re-run with --apply to inject.)`);
  }
}

main();
