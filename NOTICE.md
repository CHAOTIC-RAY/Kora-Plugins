# NOTICE — third-party attribution for Kora-Sources plugins

This file records the licences of the upstream projects that Kora's plugins
integrate with, and states plainly what is and is not vendored. It exists
because a plugin manifest that names an upstream project is a licence claim,
and an unlabelled one is a problem for whoever installs it.

Format: one section per upstream project, each stating the licence, where the
licence text lives, what we use, and what we copied.

---

## croc

* **Upstream:** https://github.com/schollz/croc
* **Author:** Zack Scholl
* **Licence:** MIT — "Copyright (c) 2017-2025 Zack Scholl"
  (`LICENSE` at the repository root)
* **Plugin:** `sources/integrations/croc.json`, authored by Kora

### What croc contains, and the licences of the parts

croc is MIT as a whole, with two exceptions that are permissively licensed but
still require attribution:

| Component | Licence | Where |
| --- | --- | --- |
| croc source | MIT | `LICENSE` |
| EFF Short Wordlist #1 | **CC BY 4.0** | `src/codephrase/wordlists/` |
| Vendored Tailcat / Tailscale | **BSD-3-Clause** | `THIRD_PARTY_NOTICES.md`, `internal/tailcat/LICENSE` |

There is no copyleft anywhere in the tree. All three licences permit
redistribution provided the copyright notice and licence text travel with it,
which is why this section exists even though Kora bundles none of it.

### What Kora uses, and what Kora copied

**Kora vendors no croc code.** Not the Go source, not the compiled WebAssembly
(`croc.wasm`), not the wordlist, not the web client.

What the plugin does is parse and validate a user-supplied croc code, and hand
the receive to croc's own web client. The Kora-side code is original, and it
implements two facts about croc's protocol that are re-derived from the
upstream source rather than copied from it:

* the shape of a code — 3 words from the EFF short wordlist joined by hyphens,
  with word 1 selecting the relay room and words 2–3 forming the PAKE
  passphrase (`src/codephrase/codephrase.go`);
* the room derivation — `sha256(roomSelector + "croc")`, and the relay index as
  the SHA-256 of the code reduced modulo the pool size.

Both are protocol facts, not copyrightable expression, and both are implemented
independently in TypeScript. The constant 1296 (the size of EFF Short Wordlist
#1) and the public relay addresses are facts of the upstream service.

### Security facts recorded on purpose

These are stated in the plugin manifest and in the panel UI, not only here,
because they change what a user should do:

* **The code is ~20.7 bits of secret, not ~31.** croc's codes are three words
  from a 1296-word list, but the first word is a *room selector* and is known to
  the relay. Only words 2–3 are secret: 1296² ≈ 20.7 bits.
* **The relay hop uses a hardcoded public key.** The relay operator can
  therefore read the control channel and see room names, timing and transfer
  sizes. It cannot read file contents and cannot impersonate a peer. File
  payloads are AES-256-GCM keyed from the two-word PAKE password.
* **A malicious sender can attack the receiving filesystem.** croc's recent
  advisories are all this one class — path traversal, symlink overwrite, and a
  case-insensitive bypass of the `.ssh` guard:
  GHSA-wmw5-q587-gx56, GHSA-m6m7-376m-rr8g, GHSA-pcm6-vvg3-3xmh,
  GHSA-x89h-7h96-v88f. This is not a weakness in croc's cryptography. It is the
  reason Kora sanitises every sender-supplied filename, and the sanitiser is
  tested against each of those four shapes.
* **Version pinning is fail-closed.** `pakekey.ProtocolVersion` rejects a
  mismatched peer outright. Kora targets croc v11.x. Older v9/v10 codes parse
  as legacy byte strings but will not complete a v11 handshake.

### Attribution owed to the EFF

Because the wordlist is CC BY 4.0 — attribution, not merely a licence notice —
the correct credit line for croc's wordlist is:

> "EFF Short Wordlist #1" — Copyright (c) 2012 Electronic Frontier Foundation,
> licensed under CC BY 4.0. <https://www.eff.org/dice>

Kora does not redistribute the list, so this credit is given here and in the
panel UI for the benefit of anyone tracing the code format back to its source.

---

## Tachiyomi and Keiyoushi

* **Upstream:** https://github.com/ZhanZiyuan/tachiyomi
* **Upstream:** https://github.com/keiyoushi/extensions-source
* **Licence:** Apache License 2.0

What we took from them, and what we did not:

  * The jsoup selector dialect for HTML sources (`:eq(n)`, `@attr`, `@text`,
    `##`, `first`, `last`). This is a *syntax*, not code, and Kora implements
    its own interpreter for it.
  * The Gen 2 registry shape (`index.json` with `extensionList.extensions[].sources[]`).
    The field names match so that tooling which already reads that format can
    read ours.
  * The convention that item urls are stored relative to `baseUrl`.

No upstream code is copied into this repository.

---

## What is ours

  * Every source file in `sources/` is our own JSON.
  * The engine that executes them (selector interpreter, JSON path resolver,
    plugin client, install/enable logic) is written from scratch for Kora.
  * Every plugin icon in `sources/*/icons/` is generated by
    `scripts/make-icons.mjs` from SVG shapes written for this repository.
    No third-party artwork is used.

If you believe something here is a derivative work of upstream, open an issue
and we will review it.
