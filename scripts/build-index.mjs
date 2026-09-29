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
  if (!plugin.baseUrl) problems.push("missing baseUrl");

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
  console.log(
    `ok  ${String(plugin.id).padEnd(24)} ${plugin.name} [${plugin.kind || "?"}]${tags.length ? " " + tags.join(",") : ""}`
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
  const rel = p.__dir || "";
  const pkg = p.gen2?.packageName || `kora.${rel || "misc"}.${slug(p.name)}`;
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
      ...(g.gen2?.homeUrl || g.baseUrl ? { homeUrl: g.gen2?.homeUrl || g.baseUrl } : {}),
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
