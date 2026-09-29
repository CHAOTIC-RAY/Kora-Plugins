/**
 * Post-build check: every source in index.json must actually resolve.
 *
 * A dead `icon` or `apkUrl` renders as a broken card, so the registry is
 * only trustworthy if each field is fetched before it is published.
 */
import { readFileSync } from "node:fs";

const index = JSON.parse(readFileSync("index.json", "utf8"));
const entries = Object.values(index.extensionList.extensions).flat();

let bad = 0;
for (const e of entries) {
  const url = e.resources?.apkUrl;
  let status = "MISSING apkUrl";
  if (url) {
    try {
      const r = await fetch(url);
      status = r.ok ? `definition ${r.status}` : `definition HTTP ${r.status}`;
    } catch (err) {
      status = "definition unreachable";
    }
  }
  let icon = "(monogram fallback)";
  try {
    const def = url ? await (await fetch(url)).json() : null;
    if (def?.icon) {
      const ir = await fetch(def.icon, { method: "HEAD" });
      icon = ir.ok ? "icon OK" : `icon HTTP ${ir.status}`;
      if (!ir.ok) bad++;
    }
  } catch {
    icon = "icon check failed";
    bad++;
  }
  const ok = status.startsWith("definition 2");
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "BAD "} ${e.name.padEnd(24)} ${status.padEnd(20)} ${icon}`);
}
console.log(`\nSUMMARY ${entries.length} sources, ${bad} problem(s)`);
if (bad) process.exit(1);
