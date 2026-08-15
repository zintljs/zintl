# `rsbuild-vue-mpa`

Two documents, two Vue roots, one shared self-anchoring header — the multi-page
case with a framework on it.

```bash
pnpm dev      # rsbuild dev
pnpm build    # rsbuild build
pnpm preview  # rsbuild preview
pnpm check    # vue-tsc
```

## Why it exists

[`rsbuild-vanilla-mpa`](../rsbuild-vanilla-mpa) established that Zintl's
multi-entry HTML path works on this host — `declareHtmlEntriesHook` and
`entriesFor` picking the right template per emitted document. This app asks
whether a framework changes that answer, the same way
[`rsbuild-react-basic`](../rsbuild-react-basic) asked it of the single-entry
case. It does not: `dist/index.html` and `dist/about.html` each get their own
`<title>`, their own `dir`, and their own catalog chunks.

## The shared boundary

`src/components/SiteHeader.vue` is imported by both pages and awaits
`zintl(locale)` **itself**, at the top level of `<script setup>`. An anchor is
independent — it does not inherit from whichever page mounted it — so the
header's strings form one boundary shared by both entries rather than being
duplicated into each.

That top-level `await` is why both roots wrap it in `<Suspense>`. It is the
Vue-idiomatic spelling of what `examples/vanilla-mpa-shared` does with an async
function, and the reason this example is worth having next to the vanilla one:
a shared anchor inside an async component is a different mounting story.

## This is not `multiplex`

Both anchors take a **variable**, so multiplex auto-detection — which looks for a
sovereign `zintl()` / `zintl("*")` — never fires. The locale is a runtime choice
via `?lang=`. Per-locale HTML fan-out is Vite-only and permanently fenced here
([L-022](../../docs/spec/proposals/027-leak-ledger.md));
[`examples/vanilla-mpa-baked-i18n`](../vanilla-mpa-baked-i18n) is that case.

## Status

Supported for build and dev, like the other Rspack examples. Capabilities are
claimed in `tests/manifests/rsbuild-vue-mpa.ts`, one at a time, each after its
contract passed here.
