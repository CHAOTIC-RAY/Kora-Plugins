# Kora Sources

Source plugins for [Kora](https://kora.chaoticstudio.workers.dev) — the open-source offline reader.

A "source" teaches Kora how to reach a website and pull titles, chapters and
page images out of it. Sources are searched alongside books, so installing one
adds its results to the same Discover feed.

**Plugins are data, not code.** Each one is a JSON file. Nothing is compiled,
bundled or executed, so a source cannot do anything a plain HTTP request could
not. That is the whole trust model.

> **A source is one category of plugin.** Kora's plugin system also covers
> themes, library integrations (Kindle, Calibre) and tools. Those categories
> are declared in the app's `PluginManifest` but have no engine yet, so this
> repository currently ships sources only.

---

## What ships here

Eight sources, every one verified end to end against its live site —
listings, then details, then chapters, then actual page images.

| Source | Kind | Status |
|---|---|---|
| Project Gutenberg | book | search only, no browse endpoint |
| Internet Archive (Texts) | book | verified |
| MangaZin | manga | 661 chapters, 18 pages verified |
| MangaReadOrg | manga | 3,864 chapters, 54 pages verified |
| ManhuaPlus | manga | 3,364 chapters, 12 pages verified |
| Manhuaus | manga | 358 chapters, 15 pages verified |
| ManhwaHot | manga | gated, 445 chapters verified |
| S2Read | manga | gated, 231 chapters verified |

Gated sources are flagged `piracy: true`. Kora lists them but keeps them
disabled until the user opts in, per source.

---

## Install

Kora ships with this registry. Open **Discover → Plugins** and hit *Refresh*.

You can also add any other registry by pasting its `index.json` URL into the
Plugins tab. That is how third-party source collections are added.

---

## Repository layout

```
index.json          generated registry — do not hand-edit
readable-history.json   per-source readability verdicts over time
sources/
  legal/            public-domain and open-licence sources
  manga/            manga and comics
  comics/
scripts/
  build-index.mjs      regenerates index.json from sources/**
  verify-readable.mjs  runs the live readability check, stamps + records history
  check-stamps.mjs     pre-commit guard: no source ships unverified
  verify-index.mjs     fetches every published definition + icon
.githooks/pre-commit   enabled with `git config core.hooksPath .githooks`
```

`index.json` is generated. Edit the source files, then run:

```bash
node scripts/build-index.mjs
```

The build **fails loudly** on a source with no `id`, no `name` or no `baseUrl`,
and on a numeric id too long to survive JSON (see *Ids* below).

After building, check that every published URL actually resolves:

```bash
node scripts/verify-index.mjs
```

A dead `apkUrl` or `icon` renders as a broken card, so shipping one is worse
than admitting the gap.

---

## Icons — required, not optional

Every source needs a **square PNG logo**, exactly as Tachiyomi ships one per
extension. Without it a grid of sources is an undifferentiated row of the
same placeholder, which is unusable when you are deciding whether to install
something.

```json
{
  "id": "kora-manga-example",
  "name": "Example Manga",
  "icon": "https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Sources/main/icons/example.png"
}
```

- Commit the file to `icons/`, 144×144 or larger, and point `icon` at its
  raw URL.
- A favicon is an acceptable fallback, but a committed PNG is better: no
  hotlink risk, and no third party able to swap the image later.
- If a ported extension already has one upstream, reuse it (the three manga
  sources here came from Keiyoushi's `res/mipmap-xxhdpi/ic_launcher.png`).

`npm run build:index` **warns** for any source with no `icon`. That warning
is the reason this rule is enforced rather than merely documented. The
pre-commit hook additionally blocks a source that has no `readable` stamp —
see *Adding a source, start to finish*.

## Why so few sites ship

Of the 29 Madara sources in the Inkdex 0.9 index, **4 are usable**. The rest
were tested and left out, and the reason is worth stating plainly because
"it didn't work" is not a useful answer.

Running `kora-repo/scripts/test-all-madara-sites.mts` classifies every site:

| Outcome | Count | Meaning |
|---|---|---|
| Listings → details → chapters → page images | **4** | shipped |
| Listing grid parses, no chapters in HTML | 7 | chapters are JavaScript-rendered; no selector can fix it |
| No parseable listing at all | 18 | wrong theme, dead, or the page 403s |

Seven sites are the interesting case. They render a perfect listing grid —
`div.page-item-detail` and all — and then serve a details page with **zero**
chapter links, because the chapter list is built client-side. Upstream's own
parser does not handle them either. They are not broken and not fixable from
here; they need a browser.

**A card that opens to an empty reader is worse than no card.** That is the
whole reason only 4 ship, and it is why `build-index.mjs` is not the place
that decides — the live test is.

## Madara sources (the big one)

Most manga sites run the same WordPress plugin. Tachiyomi handles this with a
shared base class: of 1,377 packages in the Keiyoushi registry, **248 extend
`Madara`** and about 680 extend some shared theme. A site on that plugin
costs a dozen lines, not a scraper.

Kora ports that base class. A Madara source declares only a `baseUrl`:

```json
{
  "id": "kora-manga-example",
  "name": "Example Manga",
  "lang": "en",
  "version": 1,
  "nsfw": false,
  "piracy": true,
  "kind": "manga",
  "theme": "madara",
  "baseUrl": "https://example.com"
}
```

That is a complete, working source: popular, latest, search, details, chapters
and page images. There are **no `endpoints`** — the theme supplies them.

Override only what deviates:

```jsonc
{
  "theme": "madara",
  "baseUrl": "https://example.com",
  "madara": {
    "mangaSubString": "serie",     // listing lives at /serie/ not /manga/
    "popularOrderBy": "views",
    "latestOrderBy": "update",
    "selectors": {
      "listingCard": "div.page-item-detail.manga",
      "chapterList": "li.wp-manga-chapter",
      "pageList": "div.page-break"
    }
  }
}
```

Defaults come from Keiyoushi's `MadaraBase.kt`. Ports are added to the engine
rather than to each source, so a selector fix helps every site at once.

**Adding a Madara site:** copy one of `sources/manga/*.json`, change
`baseUrl`, `id` and `name`, then verify it before opening a PR. Listing,
details, chapters *and* pages must all come back non-empty — `npm run
verify:readable` checks exactly that, using the app's own parser. Full loop
in *Adding a source, start to finish* below.

## Writing a source

Copy a working file and edit it. The smallest useful one is about twenty lines.

```json
{
  "id": "kora-manga-example",
  "name": "Example Manga Site",
  "lang": "en",
  "version": 1,
  "nsfw": false,
  "piracy": false,
  "kind": "manga",
  "baseUrl": "https://example.com",
  "endpoints": {
    "popular": {
      "url": "/latest",
      "mangas": {
        "selector": "div.manga-card",
        "title": "h2 a",
        "url": "h2 a@href",
        "thumb": "img@data-src"
      }
    }
  }
}
```

### Top-level fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique. See *Ids* below. |
| `name` | yes | Shown in the Plugins tab. |
| `lang` | yes | ISO-ish language code, e.g. `en`, `es`, `ja`. |
| `baseUrl` | yes | Site origin. Every endpoint url is relative to this. |
| `kind` | no | `manga` (page reader), `book` (EPUB/text reader), or `mixed`. Decides which reader a result opens in. |
| `api` | no | Set to `"json"` for JSON APIs. Omit for HTML sites. |
| `piracy` | no | `true` marks a shadow-library source. It is listed but stays **off** until the user switches it on, and that choice is remembered per source. |
| `nsfw` | no | Same gating, for adult content. |
| `headers` | no | Extra request headers, e.g. an API key. |
| `version` | no | Bump when selectors change, to bust cached pages. |

### Endpoints

Each endpoint is optional. Implement only what you need — a source with just
`popular` is perfectly valid.

| Endpoint | Fetches |
|---|---|
| `popular` | A browsable listing |
| `latest` | Newest items |
| `search` | Search results, using `{query}` |
| `details` | One title's metadata |
| `chapters` | Chapter list for a title |
| `pages` | Image list for one chapter |

### HTML sources — the selector dialect

Selectors are **jsoup** syntax, the same dialect Tachiyomi sources are written
in, so porting one is mostly copy-paste.

```jsonc
"selector": "div.entry"          // tag, #id, .class, [attr], [attr=val]
"selector": "a > b"              // child, a + b, a ~ b, a b (descendant)
"selector": "li:first-child"     // standard pseudo-classes
"selector": "div#date-comics ul li a:eq(0)"   // :eq(n) is shimmed (0-based)
"selector": "li:contains(\"Next\")"            // jsoup's text match
```

Field selectors read a value out of a matched element:

| Written as | Reads |
|---|---|
| `"h2"` | the element's **text** |
| `"@text"` | the element's text (explicit form) |
| `"a@href"` | the `href` attribute |
| `"img@data-src"` | the `data-src` attribute — use this for lazy-loaded covers |
| `{"selector":"h2","capture":0}` | the first number in the text (chapter numbers) |
| `{"selector":"a.genre","split":", "}` | text split on a separator |
| `{"selector":"...","resolve":false}` | leave relative urls unresolved |

Relative urls are resolved against the page they came from, so `/manga/one-piece`
becomes a full url automatically. Protocol-relative `//cdn.example/x.jpg` is
upgraded to `https://`.

Results are stored as paths relative to `baseUrl` — the same trick Tachiyomi
uses. A site that changes domain only needs its `baseUrl` updated.

### JSON sources

For APIs, set `"api": "json"` and use `endpoints.json` with dot paths:

```jsonc
{
  "api": "json",
  "baseUrl": "https://api.example.com",
  "endpoints": {
    "json": {
      "search": {
        "url": "/search?q={query}&limit=20",
        "path": "data",                       // where the array lives
        "title": "attributes.title.en",       // per item
        "url_": "id",
        "author": "author_name[]",
        "pageParam": "page",
        "limit": 20
      },
      "details": {
        "url": "/manga/{mangaId}",
        "path": "data",
        "title": "attributes.title.en",
        "description": "attributes.description.en",
        "status": { "path": "attributes.status", "map": { "ongoing": 1, "completed": 2 } }
      }
    }
  }
}
```

Path syntax:

| Path | Resolves to |
|---|---|
| `data` | the array's elements |
| `data.attributes.title` | that field on **every** element |
| `data[0]` | the first element |
| `data[].id` | shorthand for "the id of every element" |
| `attributes.title.en` | a localised field, unwrapped to its English value |

Localised objects (`{"en": "One Piece", "ja": "ワンピース"}`) are unwrapped
automatically, preferring English.

**Reliable fields, in order:** `title` and `url_` must both resolve or the item
is dropped. Everything else is optional.

### Ids

`id` is a string. If you carry a Tachiyomi Gen 2 id (a 64-bit hash like
`6289731484943315811`), **quote it**:

```json
"id": "6289731484943315811"
```

Left as a bare number it loses precision in JSON and the installed id no longer
matches the registry. The build script rejects numeric ids over 17 digits for
this reason.

---

## Testing a source

The fastest loop is to verify against the live API before opening a PR.
From this repo, one command does it — it finds the kora-repo checkout itself
and drives the app's real parser:

```bash
npm run verify:readable            # every source
npm run verify:readable my-site    # just the one you added
```

If kora-repo is not a sibling checkout, point at it:

```bash
KORA_REPO_DIR=/path/to/kora-repo npm run verify:readable
```

It runs every source through the real runtime and reports the first result it
got back. Anything unreachable is reported as SKIP, never as a pass.

For HTML sources, check the selector in a browser console first:

```js
document.querySelectorAll("div.manga-card").length
```

### Verifying a whole Madara index at once

`kora-repo/scripts/test-all-madara-sites.mts` walks every source in an
upstream index and tests each one end to end — listings, details, chapters,
then page images. A source only passes if a chapter actually yields images:

```bash
cd ../kora-repo
npx tsx scripts/test-all-madara-sites.mts            # all
npx tsx scripts/test-all-madara-sites.mts MangaZin   # one
```

`generate-madara-sources.mts` then writes a definition **only** for sites
that still pass, re-testing each one at the moment it is written. A card
that opens to an empty reader is worse than no card, so the live test —
not membership of an index — decides what ships.

Two failure modes worth knowing, because they look identical in code:

- **Selector gap** — the page contains chapter links the engine missed.
  Fixable with a per-site override in the `madara` block.
- **JS-rendered chapters** — the server HTML has no chapter list at all,
  only a "Read First" button. No selector can fix this; the site needs a
  browser. The test prints which of the two it found so you don't waste an
  afternoon on a selector that was never going to match.

---

## Contributing

1. Add the JSON under the right folder (`legal/`, `manga/`, `comics/`).
2. Run `node scripts/build-index.mjs` — it must exit 0.
3. Verify against the live site with the script above.
4. Open a PR.

Please only add sources you have actually tested. A source that silently returns
the wrong book is worse than no source at all.

---

## Legal note

A source is a **scraper**: it tells Kora how to read a page that is already
public. Kora fetches from the origin site and relays it to you. It does not
host, cache publicly, or re-publish anyone's content.

Adding a source here is not a claim of rights over that content, and marking a
source `piracy: true` is an admission that it points somewhere you probably
should not be. Sources are listed but disabled until you choose to enable them.

---

## Acknowledgements

The plugin architecture follows [Tachiyomi](https://github.com/ZhanZiyuan/tachiyomi)
and the live [Keiyoushi extension registry](https://github.com/keiyoushi/extensions-source)
(Gen 2, Apache-2.0). The selector dialect and the source contract are modelled
on theirs so existing sources port cleanly. No upstream code is copied here —
the format and all field names are our own. See `NOTICE`.

## Readability gate

A source that lists series and chapters but serves no page image is **not
readable**, and must not be published as working. This failure is invisible
to every other check: MangaZin passed all of them — valid manifest, real
icon, correct Gen 2 shape, live listings, 661 chapters — and still returned
HTTP 404 for every panel.

So the registry is gated on it. Verdicts come from the kora-repo script
below, which drives the same parser the app reads with, and are stamped into
each definition as `readable` / `readableNote`:

```bash
# re-verify every source against its live site, refresh the stamps + history
npm run verify:readable

# build the index; unreadable sources are reported but not fatal
npm run build:index

# the gate — fatal on any unreadable source. This is what CI runs.
npm run verify
```

The check walks the real chain a reader takes — listing, details, chapters,
pages — and requires the first panel to come back `200` with an `image/*`
content type. It distinguishes **unreadable** (the site works up to serving
images and then refuses — a defect) from **unreachable** (dead host, TLS
failure, timeout — not a defect), because conflating them makes a flaky
network fail the build.

The verification *logic* lives in kora-repo rather than here on purpose. An
earlier version re-implemented listing and chapter parsing in this repo and
disagreed with itself within one run — it passed S2Read and ManhuaPlus with
a loose test, then failed both once the test was tightened. A gate that
re-implements the thing it gates drifts from it, and a gate that gives the
wrong answer gets switched off.

What lives *here* is `scripts/verify-readable.mjs`: it finds the kora-repo
checkout, points the verifier at this registry, records the verdicts in
`readable-history.json`, and fails loudly if the verifier did not actually
check this registry. Run that script, not the kora-repo one — it is the entry
point that works on CI and on a machine that is not mine.

---

## Adding a source, start to finish

This is the whole loop. Nothing else is required.

**1. Get the kora-repo checkout next to this one.** The readability check
drives the app's real parser, so the app has to be present. Either clone it
as a sibling directory, or point at it explicitly:

```bash
git clone https://github.com/CHAOTIC-RAY/Kora- ../kora-repo
cd ../kora-repo && npm install      # tsx is required; the verifier is a .mts file
```

**2. Write the definition.** Copy the closest existing file and change it. A
Madara site is about twelve lines — see *Madara sources* above:

```bash
cp sources/manga/s2read.json sources/manga/my-site.json
```

At minimum it needs `id`, `name`, `lang`, `baseUrl` and `kind`. Do not add
`readable` yourself — step 3 writes it, and a value you invented is a claim
you did not check.

**3. Verify it against the live site.** This hits the real site, so it takes
about ten seconds per source:

```bash
npm run verify:readable            # all sources
npm run verify:readable my-site    # just this one
```

A new source that is not reachable from your machine reports **unreachable**,
which is not a pass. You need a machine that can reach the site, or you need to
say in the PR that you could not check it.

**4. Build and confirm the gate's opinion.**

```bash
npm run verify     # strict: exits 1 if anything is unreadable
npm run verify:index   # every published URL actually resolves
```

**5. Commit.** With the hook enabled, a source without a `readable` stamp
cannot be committed. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

**6. CI does the real check.** `.github/workflows/registry.yml` runs the same
verifier and the same strict build on every push that touches `sources/`, and
weekly on a schedule — because sources rot on their own, without a commit.

### What the gate does, and what it does not

A green run means the sources stamped `readable: true` each served a real page
image at that moment, through the app's own parser. It does **not** mean:

- the site is reachable for a normal user — the check goes through the public
  Worker relay, so a site that blocks datacenter IPs but not residential ones
  passes here and fails in the app;
- the source is the best one for that site — one chapter is sampled;
- anything about legality. This is a reachability check, nothing more.

A green run is evidence, not a certificate. That is why the workflow says so
in its own header, and why the history file exists.

## When a source fails

A source that lists series and chapters but serves no page image is the exact
shape of the bug worth catching: a perfect grid, real chapter counts, and then
a black rectangle for the user. It is the reason the gate exists.

There are three failures, and they are not the same thing:

| Failure | Means | What to do |
|---|---|---|
| `unreadable` | Site works, images do not come back | **Fix the `pageList` selector**, or drop the source. Do not ship it. |
| `unreachable` | Dead host, TLS error, timeout, or blocked from here | Not the source's fault. Leave the stamp alone and try again later or from elsewhere. |
| No `readable` stamp | Never verified | The build warns. `npm run verify:readable` to fix. |

**Currently failing, and deliberately so:** MangaZin and Manhuaus are stamped
`readable: false` — valid icon, correct Gen 2 shape, live listings, hundreds of
chapters, and HTTP 404 for every panel. They are still in `index.json` because
the build reports rather than refuses, and because whether to fix the selector
or drop them is a decision, not a side effect of running a script. Until it is
made, `npm run verify` exits 1 and CI is red. **That red is the gate working.**
Do not make it green by relaxing the gate.

If you are the one fixing one: adjust `madara.selectors.pageList`, re-run
`npm run verify:readable <name>`, and check `git diff` on the definition — a
flip from `false` to `true` is appended to `readable-history.json` and is the
evidence that it was genuinely re-tested, not re-stamped.

## Readability history

`readable-history.json` holds one entry per source per *changed* run, oldest
first, capped at eight. A run that re-confirms an unchanged verdict appends
nothing, so the file stays quiet when nothing is wrong and moves when
something is. Sources deleted from `sources/` drop out of it.

The point is that a diff is meaningful. Current state alone cannot distinguish
"this source has been readable for a year" from "this source broke yesterday
and nobody has looked", and a silent overwrite loses the moment a site
started failing.
