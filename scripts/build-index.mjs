#!/usr/bin/env node
/**
 * Build index.json from the source definitions.
 *
 * The output is deliberately in Tachiyomi **Gen 2** registry format, so this
 * repo is interchangeable with keiyoushi/extensions and any tooling that
 * already reads that shape. Kora is lenient about fields it does not use
 * (apkUrl, extensionLib) and tolerates their absence.
 *
 *   node scripts/build-index.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCES = join(ROOT, "sources");

async function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = (await collect(SOURCES)).sort();
const plugins = [];

const VALID_CATEGORIES = new Set(["source", "theme", "integration", "tool"]);

/**
 * A theme is only worth shipping if it can actually render. Check the same
 * things the app checks, so a theme that would be rejected at install time
 * fails the build instead.
 */
function validateTheme(plugin, problems) {
  if (!plugin.themeId) problems.push("theme is missing themeId");
  if (typeof plugin.dark !== "boolean") {
    problems.push('theme is missing the boolean "dark" flag');
  }
  const t = plugin.tokens;
  if (!t || typeof t !== "object") {
    problems.push("theme is missing tokens");
    return;
  }
  for (const key of ["bg", "text", "textMuted", "border", "accent", "card"]) {
    if (typeof t[key] !== "string" || !t[key].trim()) {
      problems.push(`theme token "${key}" is missing`);
    }
  }
  if (t.toastBg !== undefined && typeof t.toastBg !== "string") {
    problems.push('theme token "toastBg" must be a string when present');
  }
}

function validateIntegration(plugin, problems) {
  if (!plugin.target) {
    problems.push("integration is missing target");
  } else if (!["kindle", "calibre", "croc"].includes(plugin.target)) {
    problems.push(`unknown integration target "${plugin.target}"`);
  }
  // An integration that cannot work must say so, rather than shipping an
  // install button that does nothing.
  if (plugin.availability === "unavailable" && !plugin.availabilityNote) {
    problems.push('an "unavailable" integration must carry an availabilityNote');
  }
}

for (const f of files) {
  let plugin;
  try {
    plugin = JSON.parse(await readFile(f, "utf8"));
  } catch (err) {
    console.error(`SKIP ${basename(f)}: ${err.message}`);
    continue;
  }

  // Guard the mistakes that silently break a source at runtime.
  const problems = [];
  if (plugin.id === undefined || plugin.id === null || plugin.id === "") {
    problems.push("missing id");
  }
  if (!plugin.name) problems.push("missing name");

  // Category decides what a plugin needs. A source fetches from a site, so it
  // needs a baseUrl. A theme writes CSS tokens and an integration talks to
  // something the *user* configures in-app, so neither has (or should have) a
  // baseUrl — requiring one was rejecting every non-source plugin outright.
  const category = plugin.category || "source";
  if (!VALID_CATEGORIES.has(category)) {
    problems.push(`unknown category "${category}"`);
  }
  if (category === "source" && !plugin.baseUrl) {
    problems.push("missing baseUrl");
  }
  if (category === "theme") validateTheme(plugin, problems);
  if (category === "integration") validateIntegration(plugin, problems);

  // A numeric id longer than 17 significant digits cannot survive a JSON
  // round trip — `Number("6289731484943315811")` collapses to ...6000, so the
  // id would differ between the registry and the installed copy. A string id
  // is exempt: it is stored verbatim.
  //
  // The check must look at the parsed *type*, not at the digits. Testing
  // String(plugin.id) flags a correctly quoted id just the same, which made
  // this reject four valid sources.
  if (typeof plugin.id === "number" && String(plugin.id).length > 17) {
    problems.push(
      `numeric id ${plugin.id} has ${String(plugin.id).length} digits — JSON loses precision past 17; quote the id as a string`
    );
  }
  if (typeof plugin.id !== "string" && typeof plugin.id !== "number") {
    problems.push("id must be a string or a number");
  }
  if (problems.length) {
    console.error(`INVALID ${basename(f)}: ${problems.join("; ")}`);
    process.exitCode = 1;
    continue;
  }

  plugins.push({ ...plugin, __file: relative(SOURCES, f) });
  const tags = [];
  if (plugin.piracy) tags.push("piracy");
  if (plugin.nsfw) tags.push("nsfw");
  // The category is the first thing a reader wants to know about a plugin, so
  // it is printed rather than inferred from the directory name.
  console.log(
    `ok  ${String(plugin.id).padEnd(24)} ${plugin.name} [${category}]${tags.length ? " " + tags.join(",") : ""}`
  );
}

/** POSIX-style path, so the index works on any host reading raw.githubusercontent. */
function relative(from, to) {
  return to.slice(from.length).replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Group by the source file's parent directory. That is how a human reads the
 * repo (legal / manga / comics), and it is the only signal we have for which
 * extension an upstream source belongs to.
 */
const byPackage = new Map();
for (const p of plugins) {
  // Each category is its own package namespace, so a theme can never be
  // grouped into a source extension and vice versa.
  const cat = p.category || "source";
  const pkg = p.gen2?.packageName || `kora.${cat}.${slug(p.name)}`;
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg).push(p);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * An icon is part of a source's identity, not decoration: a grid of identical
 * puzzle pieces is impossible to scan. Prefer an icon committed to this repo —
 * stable, no hotlink risk, no third party able to swap it. Fall back to the
 * source's own favicon.
 */
function iconFor(group) {
  const icon = group.find((g) => g.icon)?.icon || "";
  if (!icon) {
    console.warn(
      `warn  ${group[0].name}: no icon — add a PNG to icons/ and point "icon" at it, ` +
        `or this source renders as an indistinguishable placeholder`
    );
  }
  return icon;
}

/**
 * A source that lists series and chapters but serves no page image is not
 * readable, and must not be published as working.
 *
 * This gate exists because that failure was invisible: MangaZin passed
 * every other check in this file — valid manifest, real icon, correct Gen 2
 * shape, live listings, 661 chapters — and still returned HTTP 404 for
 * every panel. A user installed it, opened a series, and got a black
 * rectangle with no error. Nothing in the build could see it, because
 * nothing ever fetched an image.
 *
 * The verdict comes from kora-repo's scripts/verify-registry-readable.mts,
 * which drives the same parser the app reads with. Stamps written here are
 * the input; run that script with --write to refresh them.
 *
 * KORA_STRICT_READABLE=1 (or `--strict`) turns the warning into a hard
 * failure, for CI. The flag exists because `KORA_STRICT_READABLE=1 node ...`
 * is not a valid npm script on Windows, and the gate must be runnable from
 * `npm run verify` on every machine.
 */
const STRICT = process.env.KORA_STRICT_READABLE === "1" || process.argv.includes("--strict");
const unreadable = [];
for (const g of plugins) {
  if ((g.category || "source") !== "source") continue;
  if (g.theme !== "madara" && !g.madara) continue;
  if (g.readable === false) {
    unreadable.push({ name: g.name, note: g.readableNote || "no reason recorded" });
  } else if (g.readable === undefined) {
    console.warn(
      `warn  ${g.name}: readability never verified — run ` +
        `\`npm run verify:readable\` (needs the kora-repo checkout, see README) ` +
        `or this source is published on trust`
    );
  }
}
if (unreadable.length) {
  const lines = unreadable.map((u) => `         - ${u.name}: ${u.note}`).join("\n");
  console.error(
    `\nerror: ${unreadable.length} source(s) cannot serve a page image and ` +
      `must not be published as working:\n${lines}`
  );
  if (STRICT) {
    console.error("\nKORA_STRICT_READABLE=1 — failing the build.");
    process.exit(1);
  }
  console.error(
    "\nRemove them from sources/, or set \"readable\": false with a reason.\n" +
      "Set KORA_STRICT_READABLE=1 to make this fatal."
  );
}

const extensions = [];
for (const [pkg, group] of byPackage) {
  const nsfw = group.some((g) => g.nsfw);
  const iconUrl = iconFor(group);
  extensions.push({
    name: pkg.split(".").pop().replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    packageName: pkg,
    resources: {
      // Points at the source file itself, so installing resolves to the
      // definition that declared this extension.
      apkUrl: `https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Sources/main/sources/${group[0].__file}`,
      iconUrl,
    },
    extensionLib: "kora-1",
    versionCode: "1000",
    versionName: "1.0.0",
    ...(nsfw ? { contentWarning: "CONTENT_WARNING_NSFW" } : {}),
    sources: group.map((g) => ({
      id: String(g.id),
      name: g.name,
      language: g.lang,
      // Our own fields, beyond the Gen 2 shape. Kora reads them; other
      // tooling ignores them. Declared explicitly (never omitted) so a
      // missing flag is never mistaken for "clean".
      piracy: g.piracy === true,
      nsfw: g.nsfw === true,
      // The category travels in the index so the hub can group the registry
      // into Sources / Themes / Integrations without downloading each plugin
      // file first. Defaults to "source" for registries that omit it.
      category: g.category || "source",
      // Theme + integration payload the hub needs to render a card and decide
      // whether the thing can actually work. Only present on those categories.
      ...(g.themeId ? { themeId: g.themeId } : {}),
      ...(g.tokens ? { tokens: g.tokens } : {}),
      ...(typeof g.dark === "boolean" ? { dark: g.dark } : {}),
      ...(g.target ? { target: g.target } : {}),
      ...(g.availability ? { availability: g.availability } : {}),
      ...(g.availabilityNote ? { availabilityNote: g.availabilityNote } : {}),
      ...(Array.isArray(g.requires) && g.requires.length ? { requires: g.requires } : {}),
      ...(g.description ? { description: g.description } : {}),
      ...(g.author ? { author: g.author } : {}),
      ...(g.gen2?.homeUrl || g.baseUrl || g.website
        ? { homeUrl: g.gen2?.homeUrl || g.baseUrl || g.website }
        : {}),
    })),
  });
}

const index = {
  name: "Kora Sources",
  badgeLabel: "KORA",
  contact: { website: "https://github.com/CHAOTIC-RAY/Kora-Sources" },
  extensionList: { extensions },
};

await writeFile(join(ROOT, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(`\nindex.json: ${extensions.length} extensions, ${plugins.length} sources`);
