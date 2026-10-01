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
import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCES = join(ROOT, "sources");

/**
 * The GitHub `owner/repo` this registry is served from.
 *
 * Every URL the app fetches — plugin definitions AND their icons — is derived
 * from this one value, so a rename touches this line and nothing else.
 *
 * It was previously hardcoded as `Kora-Sources` in two places. When the repo
 * was renamed to `Kora-Plugins`, the new repo was seeded as a byte-for-byte
 * copy of the old index, so the new repo's own index pointed all 27 of its
 * download and icon URLs back at the OLD repo. It served 200 and installed
 * fine, so nothing looked broken — but the plugin hub showed the old name and
 * every plugin was fetched from a repo scheduled for deletion. See
 * https://github.com/CHAOTIC-RAY/Kora-Plugins for the current slug.
 *
 * Resolution order, most explicit first:
 *   1. KORA_REGISTRY_SLUG — set it if the checkout is published from somewhere
 *      else (a fork under a different account).
 *   2. the `origin` remote, so a clone taken from the real repo self-corrects.
 *   3. the constant below.
 */
const FALLBACK_SLUG = "CHAOTIC-RAY/Kora-Plugins";

function resolveSlug() {
  const fromEnv = process.env.KORA_REGISTRY_SLUG?.trim();
  if (fromEnv) return fromEnv;

  // Best-effort: a clone made from the real repo already knows its own name,
  // so the constant below can never drift from the actual remote.
  try {
    const cfg = readFileSync(join(ROOT, ".git", "config"), "utf8");
    const m = cfg.match(/\[remote "origin"\][^[]*url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
    if (m) return m[1];
  } catch {
    // No .git (CI tarball, npm pack) — the constant is the answer.
  }
  return FALLBACK_SLUG;
}

const SLUG = resolveSlug();
const RAW_BASE = `https://raw.githubusercontent.com/${SLUG}/main`;
const WEB_BASE = `https://github.com/${SLUG}/raw/main`;
const REPO_URL = `https://github.com/${SLUG}`;
/** Owner half of the slug, used to scope URL rewriting to our own repos only. */
const OWNER_PART = SLUG.split("/")[0];

console.log(`registry slug: ${SLUG}`);

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
 *
 * A committed icon is preferred in the manifest as a bare repo-relative path
 * ("icons/calibre.png"). An ABSOLUTE github.com URL is rewritten onto the
 * current slug — those were written while the repo was called Kora-Sources and
 * would otherwise keep serving icons from the old repo, which is exactly the
 * failure this module exists to prevent. A non-GitHub absolute URL (a source's
 * own favicon) is left untouched.
 */
function iconFor(group) {
  const icon = group.find((g) => g.icon)?.icon || "";
  if (!icon) {
    console.warn(
      `warn  ${group[0].name}: no icon — add a PNG to icons/ and point "icon" at it, ` +
        `or this source renders as an indistinguishable placeholder`
    );
    return "";
  }
  return rewriteSlug(icon);
}

/**
 * Repoint a GitHub URL at the current slug, whichever of the two forms it uses:
 *
 *   https://github.com/OWNER/REPO/...          (web + /raw/ asset paths)
 *   https://raw.githubusercontent.com/OWNER/REPO/...   (raw asset paths)
 *
 * Scoped to OUR owner on purpose — a plugin may legitimately link a third
 * party's GitHub (croc → schollz/croc), and repointing that would break it.
 * Anything not on github.com is returned unchanged.
 */
function rewriteSlug(url) {
  if (typeof url !== "string" || !/github(?:usercontent)?\.com/i.test(url)) return url;
  return url.replace(
    // Only the owner/repo pair; the lookahead stops it eating the path after it.
    new RegExp(
      `((?:raw\\.githubusercontent\\.com|github\\.com)/)${OWNER_PART}/[^/\\s"]+`,
      "i"
    ),
    (_m, base) => `${base}${SLUG}`
  );
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
      apkUrl: `${RAW_BASE}/sources/${group[0].__file}`,
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
      // The readability verdict travels in the index so the app can say so
      // BEFORE the user installs and opens a chapter. Kora reads it and
      // badges the source; see `isUnreadableSource` in kora-repo.
      // Emitted only when declared — an absent flag means "unverified", and
      // the app treats that as readable so an old index cannot make working
      // sources look dead.
      ...(g.readable === false ? { readable: false } : {}),
      ...(g.readableNote ? { readableNote: g.readableNote } : {}),
      ...(g.readableCheckedAt ? { readableCheckedAt: g.readableCheckedAt } : {}),
      ...(g.description ? { description: g.description } : {}),
      ...(g.author ? { author: g.author } : {}),
      ...(g.gen2?.homeUrl || g.baseUrl || g.website
        // Same reason as iconFor: these manifests were authored while the repo
        // was Kora-Sources, and the stale slug would reach the hub's "home" link.
        ? { homeUrl: rewriteSlug(g.gen2?.homeUrl || g.baseUrl || g.website) }
        : {}),
    })),
  });
}

const index = {
  name: "Kora Plugins",
  badgeLabel: "KORA",
  contact: { website: REPO_URL },
  extensionList: { extensions },
};

const serialised = JSON.stringify(index, null, 2) + "\n";

/**
 * Hard guard: the registry must not fetch its OWN assets from a different repo.
 *
 * This is the check that would have caught the Kora-Sources bug at build time.
 * A stale self-reference is invisible to a reviewer skimming a diff, serves a
 * 200 from the old repo, installs correctly, and only shows up as a wrong name
 * in the hub — so it has to be asserted, not eyeballed.
 *
 * Scoped by OWNER, deliberately. A plugin legitimately points at a third
 * party's GitHub for its icon or homepage (croc → schollz/croc), and flagging
 * those would make the guard noise nobody can act on. Only a *different repo
 * under our own owner* is the bug: that is a renamed-away copy of ourselves.
 */
const OWNER = SLUG.split("/")[0].toLowerCase();
const foreign = [
  ...new Set(
    [...serialised.matchAll(/github\.com\/([^/\s"]+)\/([^/\s"]+)/gi)]
      .map((m) => ({ owner: m[1], repo: m[2], slug: `${m[1]}/${m[2]}` }))
      .filter((r) => r.owner.toLowerCase() === OWNER && r.repo.toLowerCase() !== SLUG.split("/")[1].toLowerCase())
      .map((r) => r.slug)
  ),
];
if (foreign.length) {
  console.error(
    `\nerror: index.json points at ${foreign.length} repo(s) under ${OWNER} other than ${SLUG}:\n` +
      foreign.map((s) => `         - ${s}`).join("\n") +
      `\n\nThese URLs keep serving the old repo, so the hub shows its name and every\n` +
      `plugin installs from a repo we no longer publish to. Fix the "icon" in the\n` +
      `manifest, or set KORA_REGISTRY_SLUG if this checkout is published elsewhere.`
  );
  process.exit(1);
}

await writeFile(join(ROOT, "index.json"), serialised, "utf8");
console.log(`\nindex.json: ${extensions.length} extensions, ${plugins.length} sources`);
console.log(`all github.com refs point at ${SLUG}`);
