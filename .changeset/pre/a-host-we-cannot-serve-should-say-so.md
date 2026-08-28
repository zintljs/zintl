---
"zintljs": minor
---

Refuse to build on a host with no bundler facet, and stop claiming Next.js when we mean vinext.

Two ways a project could be told it was supported when it was not.

**A host with no bundler facet now fails at construction.** Virtual module resolution, the
dynamic-import shape, HMR acceptance and chunk alignment all arrive from the facet whose `concern` is
`"bundler"`, and exactly one activates per build, chosen by `when: { bundler }`. When none did, the
compiler was constructed anyway and every one of those fell back to a Vite-shaped default the actual
host does not honour — so on webpack, Rollup, esbuild or Farm the build got far enough to produce
output, and the output was wrong. It now stops, names the two supported entry points, and says how to
add a third:

```
[Zintl] Unsupported build tool: "webpack".

No bundler facet claims it, so Zintl cannot resolve its virtual modules or align
catalogs with your chunks. It stops here rather than building something wrong.

Supported hosts:
  Vite     import zintl from "zintljs/vite"     (vite.config.ts)
  Rsbuild  import zintl from "zintljs/rsbuild"  (rsbuild.config.ts)
```

The check asks the facet system rather than an allowlist, so contributing a bundler facet lifts the
fence by itself — which is the premise the faceted architecture rests on, and is covered by a test
that registers a `farm` facet and expects the build to proceed.

**`nextjs` detection is gated on `vinext`.** It read `allDeps["next"] || allDeps["vinext"]`, and
matched `includes("next")` against plugin names — a substring test on four very common letters, in a
file that already documents why substring matching is unsafe here (`splitVendorChunk` is why Solid
uses separator boundaries).

That was wrong on both counts. The Next.js facets wrap `virtual:vinext-rsc-entry`,
`virtual:vinext-server-entry` and `virtual:vinext-app-ssr-entry`, so on a real webpack or Turbopack
Next.js build they have nothing to bind to. And a false positive was not inert: `nextjs-runtime`
declares `supersedes: ["ssr-runtime", "client-spa"]`, so any Vite SPA that merely had `next` somewhere
in its dependency tree — a monorepo is enough — silently lost client locale sync to a facet set that
then attached to nothing. A false positive here is worse than no detection at all.

**The docs now say which is which.** `README.md` replaces the prose support claim with a host ×
framework × app-shape matrix, and states plainly what is _not_ supported: Next.js on
webpack/Turbopack (Turbopack has no public plugin API, and webpack is the bundler Next.js is moving
away from), and the Vite-based meta-frameworks — Nuxt, SvelteKit, Astro, Remix, TanStack Start —
which report Vite as the host, so the plugin loads, the fence never fires, and nothing is tested.
Unexplored, not supported, and the only ones nothing will warn you about at build time.

`docs/configuration.md` gains a **Next.js via vinext** section covering exactly what the facets do,
and one fact the examples directory did not make obvious: `examples/vinext-basic` is the only example
absent from the contract manifest, so no browser test drives it. It is marked experimental.
