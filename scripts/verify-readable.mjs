#!/usr/bin/env node
/**
 * Run the readability verifier over this registry, from this repo.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The check itself lives in kora-repo (scripts/verify-registry-readable.mts)
 * because it must drive the app's real `createMadaraClient` parser. A gate that
 * re-implements scraping drifts from the app, and a gate that gives the wrong
 * answer gets ignored — that already happened once, in a scraper that lived
 * here. So: the logic stays there, the *orchestration* lives here, and this
 * file is what a contributor or CI actually runs.
 *
 * It does three things the kora-repo script deliberately does not:
 *   1. finds the kora-repo checkout without a hardcoded absolute path
 *      (KORA_REPO_DIR, else a sibling-directory search);
 *   2. passes this registry's location through KORA_SOURCES_DIR;
 *   3. records the verdicts in readable-history.json, so a source that goes
 *      readable -> unreadable shows up as a diff instead of silently
 *      overwriting the last answer.
 *
 *   node scripts/verify-readable.mjs            # verify, stamp, record
 *   node scripts/verify-readable.mjs --write    # same; --write is the default
 *                                               # here and kept for symmetry
 *   node scripts/verify-readable.mjs s2read     # only sources matching a name
 *   node scripts/verify-readable.mjs --no-stamp # verify, record, but do not
 *                                               # touch sources/**.json
 *
 * EXIT CODES
 *   0  every source checked is readable (or not applicable)
 *   1  at least one source cannot serve a page image
 *   2  the verifier could not be run at all (missing kora-repo, missing tsx,
 *      or the verifier did not see this registry — see below)
 *
 * THE FAIL-SAFE THAT MATTERS
 * --------------------------
 * If kora-repo's script ignores KORA_SOURCES_DIR and looks at its own
 * hardcoded path, it will happily verify *zero* sources and exit 0. A CI gate
 * that goes green because it checked nothing is worse than no gate, so this
 * script compares the number of verdicts the verifier reported against the
 * number of definitions actually on disk and exits 2 on a mismatch. That is
 * why `--strict` on the build alone is not enough.
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Where this registry's definitions live. Overridable so CI is not tied to a path. */
const SOURCES_DIR = resolve(process.env.KORA_SOURCES_DIR || join(ROOT, "sources"));
const HISTORY = join(ROOT, "readable-history.json");

/**
 * How many verdicts to keep per source. Eight weeks of weekly runs is enough
 * to see a site rot and a site come back; more than that and the file becomes
 * a log nobody reads, which is the same as no history.
 */
const KEEP_PER_SOURCE = 8;

const argv = process.argv.slice(2);
const STAMP = !argv.includes("--no-stamp");
const ONLY = argv.filter((a) => !a.startsWith("--"));

/* ------------------------------------------------------- locate kora-repo */

/**
 * Candidate locations for the app checkout, in order. The sibling search is
 * what makes this work without configuration on a normal dev machine (the two
 * repos sit next to each other) and without configuration on CI (the workflow
 * checks kora-repo out beside this one).
 */
function findAppRepo() {
  if (process.env.KORA_REPO_DIR) return resolve(process.env.KORA_REPO_DIR);

  const parent = dirname(ROOT);
  const candidates = [
    join(parent, "kora-repo"),
    join(parent, "Kora"),
    join(parent, "kora"),
    join(ROOT, "..", "Kora-"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "scripts", "verify-registry-readable.mts"))) return resolve(c);
  }
  return null;
}

const APP = findAppRepo();
if (!APP) {
  console.error(
    "error: cannot find the kora-repo checkout.\n" +
      "       It holds the readability verifier, because the check must drive the\n" +
      "       app's real parser. Point KORA_REPO_DIR at it:\n\n" +
      "         KORA_REPO_DIR=../path/to/kora-repo node scripts/verify-readable.mjs\n"
  );
  process.exit(2);
}

const TSX = join(APP, "node_modules", "tsx", "dist", "cli.mjs");
const VERIFIER = join(APP, "scripts", "verify-registry-readable.mts");
if (!existsSync(TSX)) {
  console.error(
    `error: tsx is not installed in ${APP}\n` +
      "       Run \`npm install\` there first — the verifier is a .mts file."
  );
  process.exit(2);
}

/* ----------------------------------------------- what is actually on disk */

async function collect(dir) {
  const out = [];
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of dirents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = (await collect(SOURCES_DIR)).sort();
if (!files.length) {
  console.error(`error: no source definitions under ${SOURCES_DIR}`);
  process.exit(2);
}

/** Only the definitions the verifier will actually make a network call for. */
async function checkableOnDisk() {
  const out = [];
  for (const f of files) {
    let def;
    try {
      def = JSON.parse(await readFile(f, "utf8"));
    } catch {
      continue;
    }
    if ((def.category || "source") !== "source") continue;
    if (def.theme !== "madara" && !def.madara) continue;
    out.push(f);
  }
  return out;
}

const expected = await checkableOnDisk();

/* ------------------------------------------------------------- run it */

const args = [TSX, VERIFIER, ...(STAMP ? ["--write"] : []), ...ONLY];
console.log(`verifier: ${APP}`);
console.log(`registry: ${SOURCES_DIR} (${expected.length} checkable source(s))\n`);

const code = await new Promise((res) => {
  const child = spawn(process.execPath, args, {
    cwd: APP,
    stdio: "inherit",
    env: {
      ...process.env,
      KORA_SOURCES_DIR: SOURCES_DIR,
      // The app's own copy of the registry, if it keeps one. Harmless if unused.
      KORA_SOURCES_OUT: SOURCES_DIR,
    },
  });
  child.on("close", res);
});

/* ------------------------------------- did it actually check our registry? */

const reportPath = join(APP, "sources-readable.json");
let report = null;
if (existsSync(reportPath)) {
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    /* fall through to the count check below */
  }
}

if (report && Array.isArray(report.results) && !ONLY.length) {
  // Every checkable definition on disk must appear in the report, and every
  // report entry that is not "not-applicable" must be a checkable one. A short
  // count means the verifier read some other directory.
  const judged = report.results.filter((r) => r.verdict !== "not-applicable");
  if (judged.length !== expected.length) {
    console.error(
      `\nerror: the verifier returned ${judged.length} verdict(s) but ${expected.length} ` +
        `checkable source(s) exist under\n       ${SOURCES_DIR}. It did not read this registry.\n` +
        "       This is the failure mode that makes a gate look green while checking\n" +
        "       nothing: kora-repo's scripts/verify-registry-readable.mts is probably\n" +
        "       still using a hardcoded sources path instead of KORA_SOURCES_DIR.\n"
    );
    process.exit(2);
  }
}

/* --------------------------------------------------- record the history */

/**
 * Append this run's verdicts to readable-history.json.
 *
 * Written as one entry per source per run, oldest first, capped at
 * KEEP_PER_SOURCE. A verdict identical to the previous one is not appended —
 * a weekly run that keeps re-proving the same thing should leave the file
 * byte-identical, so the only diffs in git are the ones that mean something:
 * a source broke, or a source came back.
 */
async function recordHistory(results) {
  let existing = { version: 1, sources: {} };
  if (existsSync(HISTORY)) {
    try {
      existing = JSON.parse(await readFile(HISTORY, "utf8"));
    } catch {
      /* corrupt history is not worth failing a run over; it is rebuilt below */
    }
  }
  const sources = existing.sources && typeof existing.sources === "object" ? existing.sources : {};

  for (const r of results) {
    if (r.verdict === "not-applicable") continue;
    const key = String(r.id);
    const prev = Array.isArray(sources[key]) ? sources[key] : [];
    const last = prev[prev.length - 1];
    const entry = { at: r.checkedAt, verdict: r.verdict, stage: r.stage, detail: r.detail };
    if (last && last.verdict === entry.verdict && last.stage === entry.stage) continue;
    sources[key] = [...prev, entry].slice(-KEEP_PER_SOURCE);
    sources[key].name = r.name;
  }

  // A source deleted from sources/ must not leave a permanent record behind.
  const live = new Set(results.map((r) => String(r.id)));
  for (const key of Object.keys(sources)) if (!live.has(key)) delete sources[key];

  const sorted = {};
  for (const key of Object.keys(sources).sort()) sorted[key] = sources[key];

  const out = {
    version: 1,
    updatedAt: new Date().toISOString(),
    note:
      "One entry per source per changed run, oldest first, capped at " +
      `${KEEP_PER_SOURCE}. Produced by scripts/verify-readable.mjs. A source that ` +
      "flips readable <-> unreadable shows up here as a diff; that is the point.",
    sources: sorted,
  };
  await writeFile(HISTORY, JSON.stringify(out, null, 2) + "\n", "utf8");
  return out;
}

if (report && Array.isArray(report.results) && !ONLY.length) {
  const hist = await recordHistory(report.results);
  const n = Object.values(hist.sources).reduce((a, s) => a + s.length, 0);
  console.log(`\nreadable-history.json: ${Object.keys(hist.sources).length} source(s), ${n} recorded verdict(s)`);
}

/* ------------------------------------------------------------- verdict */

if (code === 2) {
  console.error("\nthe verifier could not run. Nothing was verified; this is not a pass.");
  process.exit(2);
}
if (code === 1) {
  console.error(
    "\nAt least one source lists series and chapters but serves no page image.\n" +
      "A user who installs it gets a black rectangle and no error. Fix the\n" +
      "selectors, or remove the source — do not publish it as working.\n" +
      "See README 'When a source fails'."
  );
}
process.exit(code);
