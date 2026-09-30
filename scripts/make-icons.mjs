/**
 * Generate the plugin icons.
 *
 * Icons are rendered here rather than committed as opaque binaries so the
 * palette stays in one place and a colour tweak is a one-line diff. Output is
 * a real 256x256 PNG per plugin, matching the square icons already in the repo.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// This repo is data-only and has no dependencies of its own, so `sharp` is
// resolved out of the app checkout that sits next to it. That keeps the icon
// pipeline reproducible without adding a node_modules here.
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  const fallback = new URL("../../kora-repo/node_modules/sharp", import.meta.url);
  sharp = createRequire(fallback)("sharp");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** @type {{path: string, bg: string, fg: string, accent: string, glyph: string}[]} */
const ICONS = [
  { path: "sources/themes/icons/copper-night.png", bg: "#12100E", fg: "#F2EDE4", accent: "#C8853A", glyph: "moon" },
  { path: "sources/themes/icons/mint-terminal.png", bg: "#0C1410", fg: "#D6F5E0", accent: "#4ADE80", glyph: "prompt" },
  { path: "sources/integrations/icons/calibre.png", bg: "#2B2118", fg: "#F3E9D8", accent: "#D08C3C", glyph: "books" },
  { path: "sources/integrations/icons/send-to-kindle.png", bg: "#23262B", fg: "#E8EAED", accent: "#9AA3AE", glyph: "device" },
];

const SIZE = 256;

/** Draw each glyph as inline SVG so sharp can rasterise it. */
function svg({ bg, fg, accent, glyph }) {
  const shapes = {
    moon: `
      <circle cx="128" cy="120" r="58" fill="${fg}"/>
      <circle cx="152" cy="104" r="54" fill="${bg}"/>`,
    prompt: `
      <rect x="70" y="92" width="16" height="52" rx="4" fill="${accent}"/>
      <rect x="102" y="92" width="16" height="52" rx="4" fill="${accent}"/>
      <rect x="134" y="138" width="72" height="14" rx="4" fill="${fg}" opacity="0.85"/>
      <rect x="70" y="176" width="136" height="12" rx="4" fill="${fg}" opacity="0.35"/>`,
    books: `
      <rect x="66" y="96" width="34" height="106" rx="6" fill="${accent}"/>
      <rect x="106" y="80" width="34" height="122" rx="6" fill="${fg}"/>
      <rect x="146" y="108" width="34" height="94" rx="6" fill="${accent}" opacity="0.75"/>
      <rect x="66" y="200" width="114" height="10" rx="5" fill="${fg}" opacity="0.4"/>`,
    device: `
      <rect x="92" y="66" width="72" height="124" rx="10" fill="${fg}"/>
      <rect x="104" y="80" width="48" height="80" rx="4" fill="${bg}"/>
      <circle cx="128" cy="174" r="8" fill="${accent}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" rx="52" fill="${bg}"/>
    ${shapes[glyph]}
  </svg>`;
}

for (const spec of ICONS) {
  const out = join(ROOT, spec.path);
  await mkdir(dirname(out), { recursive: true });
  const png = await sharp(Buffer.from(svg(spec))).png().toBuffer();
  await writeFile(out, png);
  console.log(`ok  ${spec.path}  ${png.length} bytes`);
}
console.log(`\n${ICONS.length} icons written`);
