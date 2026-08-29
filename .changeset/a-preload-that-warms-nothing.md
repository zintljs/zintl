---
"zintljs": patch
"@zintljs/compiler": patch
---

Make the locale preload hint point at the catalog it means to warm.

The HTML projection writes a `modulepreload` per locale so the catalog is in
cache by the time the store asks for it. It had two faults, and between them the
hint never once did its job on a route below the root.

**The URL was relative.** The base was read from `viteCtx.server.config.base`, and `server` exists
only in dev — so a production build fell back to `""` and emitted a bare `assets/entry_….js`.
Assigned to `link.href` that resolves against the _document_, so `/guide/page` asked for
`/guide/assets/entry_….js`: a 404 on every deep-route load, and a preload that warmed nothing.
Quietly, because the real import is written `./entry_….js` from inside a module and resolves
correctly — the page worked, and only the network panel showed otherwise.

On a host with the SPA fallback a single-page app needs, it is worse than a 404: the request returns
`index.html` with a 200 and the preload fails on its content type instead.

The base now comes from `configResolved`, where it exists in both modes. **Every project's preloads
were relative** — this shows up as an absolute path in twenty contract snapshots.

**And it preloaded the wrong locale.** The bootstrap chose from `localStorage` alone, so arriving at
`/es/guide` with `ar` left in storage applied Arabic `lang`, `dir` and `<title>` to a Spanish
document and fetched the Arabic catalog. It now reads the first path segment first and falls back to
storage, which is the precedence `syncLocale` already uses. A path whose first segment names no
locale falls through exactly as before, so apps that keep the locale in `?lang=` are unaffected.

Guarded by two tests whose fixture has **no `server`**, which is what a build looks like. The test
that covered this path supplied one, and that is why the relative URL survived being tested.
