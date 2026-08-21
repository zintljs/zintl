# `preact-basic`

`create-vite`'s **preact-ts** starter, localized. The smallest possible answer to
"is adding a framework really additive?" — Preact reuses React's entire
extraction surface and differs in two declarations.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc -b && vp build
pnpm preview  # vp preview
```

## What Preact costs

`preactExtractionFacet` and `reactExtractionFacet` read the same `JSX_TARGETS`
list from `packages/compiler/src/facet/presets/jsx.ts`, because JSX is JSX. Two
things differ, and both are declarations rather than code:

- **The subscription hook comes from `preact/compat`.** `preact/hooks` does not
  export `useSyncExternalStore`; naming the wrong module fails the build rather
  than failing silently, which is the good case — but only because the facet
  names it at all. The compiler must not know what Preact is.
- **Re-running the entry is safe here, and is not in React.** `createRoot` mounts
  a _second_ root over a container it already owns, so `reactRuntimeFacet`
  declares `entryReexecutionSafe: false` and pays a full page reload on those
  updates. Preact's `render(vnode, parent)` diffs against the tree already on the
  container, so it replaces. Measured before it was declared — see the docblock
  on `preactRuntimeFacet`.

## Detection prefers Preact over React, deliberately

`@preact/preset-vite` aliases `react` and `react-dom` to `preact/compat`, so this
app has React in its module graph and its plugin list. `detectFrameworks` checks
Preact first and uses `else`, because a project resolving as _both_ would
activate two codegen facets claiming `.tsx` — a hard error at facet
construction. A Preact app is not a React app that also uses Preact.

## What is not vendored

The Preact logo. The other examples show their framework's mark, and shipping a
hand-drawn approximation of someone's trademark is worse than showing none, so
the hero here carries the neutral shape and the Vite logo only.
