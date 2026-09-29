# Kora Sources

Source plugins for [Kora](https://kora.chaoticstudio.workers.dev) — the open-source offline reader.

A "source" teaches Kora how to reach a website and pull titles, chapters and
page images out of it. Sources are searched alongside books, so installing one
adds its results to the same Discover feed.

**Plugins are data, not code.** Each one is a JSON file. Nothing is compiled,
bundled or executed, so a source cannot do anything a plain HTTP request could
not. That is the whole trust model.

---

## Install

Kora ships with this registry. Open **Discover → Plugins** and hit *Refresh*.

You can also add any other registry by pasting its `index.json` URL into the
Plugins tab. That is how third-party source collections are added.

---

## Repository layout

```
index.json          generated registry — do not hand-edit
sources/
  legal/            public-domain and open-licence sources
  manga/            manga and comics
  comics/
scripts/
  build-index.mjs   regenerates index.json from sources/**
```

`index.json` is generated. Edit the source files, then run:

```bash
node scripts/build-index.mjs
```

The build **fails loudly** on a source with no `id`, no `name` or no `baseUrl`,
and on a numeric id too long to survive JSON (see *Ids* below).

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
is the reason this rule is enforced rather than merely documented.

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
details, chapters *and* pages must all come back non-empty.

```bash
cd ../kora-repo
npx tsx src/lib/sources/__tests__/verify-madara-live.mts   # after adding the site to the list
```

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

The fastest loop is to verify against the live API before opening a PR:

```bash
cd ../kora-repo
SOURCES_DIR=D:/Wafig/Hermes/Kora-Sources/sources \
  npx tsx src/lib/sources/__tests__/verify-live.mts
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
