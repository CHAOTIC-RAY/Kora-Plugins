#!/usr/bin/env node
/**
 * Pre-commit guard: refuse to commit a source definition that has never been
 * checked against its live site.
 *
 * The check is on *staged* files, not the whole registry, on purpose:
 *
 *   - It cannot be bypassed by committing from a different directory.
 *   - It stays fast. A full readability run is ~60s of live HTTP against six
 *     manga sites; doing that on every commit is how you get `--no-verify`
 *     written into a team's muscle memory. The live run belongs in
 *     `npm run verify:readable` and in CI, not in the commit path.
 *   - It does not block unrelated work. Sources already committed as
 *     unreadable (MangaZin, Manhuaus) keep the commit open, because failing
 *     every commit over a known, already-recorded problem is a gate people
 *     turn off rather than a gate that protects anything.
 *
 * So: this guards the *new* thing. `npm run verify:readable` guards the truth.
 *
 *   node scripts/check-stamps.mjs            # inspect the index
 *   node scripts/check-stamps.mjs --all      # every definition, not just staged
 *
 * Exits 1 with an instruction if any staged definition lacks a `readable` key.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALL = process.argv.includes("--all");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/** Staged source definitions, plus renames handled as-is (git prints the new path). */
function staged() {
  if (ALL) {
    // `git ls-files` covers committed + staged, so --all also catches a
    // definition that was committed without ever going through the hook.
    return git(["ls-files", "sources"]).split("\n").filter(isDefinition);
  }
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return out.split("\n").filter(isDefinition);
}

/**
 * sources/ also holds icon PNGs (sources/integrations/icons/*.png). A
 * definition is a .json file directly under a category directory, not under
 * an `icons/` folder — so exclude that, rather than trusting every .json in
 * the tree to be parseable.
 */
function isDefinition(f) {
  return Boolean(f) && /^sources\/[^/]+\/[^/]+\.json$/.test(f) && !f.includes("/icons/");
}

const files = staged();
if (!files.length) {
  console.log("check-stamps: no source definitions staged.");
  process.exit(0);
}

/** Integrations and themes are shipped without a scraper, so they never get stamped. */
const needsStamp = (def) => (def.category || "source") === "source";

const missing = [];
for (const f of files) {
  let def;
  try {
    def = JSON.parse(await readFile(join(ROOT, f), "utf8"));
  } catch (err) {
    console.error(`check-stamps: ${f} is not valid JSON — ${err.message}`);
    process.exit(1);
  }
  if (!needsStamp(def)) continue;
  if (typeof def.readable !== "boolean") missing.push({ f, name: def.name || f });
}

if (missing.length) {
  console.error(
    `\ncommit blocked: ${missing.length} staged source(s) have no readability verdict.\n\n` +
      missing.map((m) => `  - ${m.f}  (${m.name})`).join("\n") +
      "\n\nA source is published on trust until someone proves it serves page images.\n" +
      "Verify it against the live site, then commit the stamps:\n\n" +
      "  npm run verify:readable          # checks the live site, writes stamps + history\n" +
      "  git add -A && git commit         # this hook then passes\n\n" +
      "If the site is unreachable from your machine the run reports 'unreachable'\n" +
      "and leaves the stamp alone — that is not a pass, and CI will catch it.\n"
  );
  process.exit(1);
}

console.log(`check-stamps: ${files.length} staged definition(s), all stamped.`);
