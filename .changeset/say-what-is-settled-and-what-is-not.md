---
"zintljs": patch
---

Add a stability contract, and say plainly that adopting Zintl is reversible.

"Alpha" was doing two jobs in the README: describing the release channel, and standing in for a
per-surface answer nobody had written down. So a team evaluating Zintl had to assume everything
could move, which is both untrue and the most expensive assumption available.

[`docs/stability.md`](../docs/stability.md) splits it. Settled: the `zintl(locale)` anchor and the
whole `zintljs/macro` surface, both entry points, `locales` / `sourceLocale`, the on-disk catalog
format, `outputDir` / `catalogFormat`, content-based identity, and the no-fallback rule. Still
moving, and named as such: the `facets` API, ICU coverage, the boundary-id encoding, vinext, and
diagnostic text.

Top of the moving list, because it is the one we expect to revisit before 1.0: `assetsTarget`,
`virtualAssets` and `similarityThreshold` exist both as top-level options and on the facets that
consume them. One concept, two spellings. The page states today's precedence rule rather than
leaving people to discover it.

It also documents **removing Zintl**, which had never been written down anywhere and is the
strongest thing there is to say about depending on an alpha compiler from a small team. There is
nothing to unwind: no `t()` wrappers, no keys, no dictionary — the strings in your components are
the strings you wrote, so deleting the plugin leaves the monolingual app you started with. Half-way
works too, because the macro bodies are real: `t(key)` returns the key, `zintl()` yields an inert
handle, and an app that still imports them without the plugin renders in its source locale rather
than crashing.

Adoption being reversible in one commit is a consequence of the design, not a feature. It should not
have been discoverable only by reading `macro.ts`.
