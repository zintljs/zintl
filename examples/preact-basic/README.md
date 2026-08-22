# `preact-basic`

`create-vite`'s **preact-ts** starter, localized. The smallest possible answer to
"is adding a framework really additive?"

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc -b && vp build
pnpm preview  # vp preview
```

Read it as "I ran `pnpm create vite --template preact-ts`, then added
localization". The page, the CSS, the `preact.svg` hero and the `#app` mount
point are the template's, untouched. What was added is the localization layer:
`zintl()` in `src/main.tsx`, the `?lang=` query parameter, the bar in
`src/components/LocaleSwitcher.tsx`, and the catalogs under `zintl/`.

Two edits to the template's own files, both minimal: `src/app.tsx` takes `lang`
and `onSwitch` and renders the bar, and `src/main.tsx` awaits the anchor before
the first render so nothing paints untranslated.

## What Preact costs

`preactExtractionFacet` and `reactExtractionFacet` read the same `JSX_TARGETS`
and claim the same extensions, because the syntax is the same. Two declarations
differ, and both are cases React cannot express:

- **The subscription hook is not in `preact/hooks`.** `useSyncExternalStore`
  lives in `preact/compat`, so `preactCodegenFacet` names that module. Getting it
  wrong fails at build time rather than silently, which is the good case.
- **Re-running the entry is safe here.** React's `createRoot` on a container it
  already owns mounts a second root over the first, which is why
  `reactRuntimeFacet` declares `entryReexecutionSafe: false` and pays a reload.
  Preact's `render()` diffs against the container's existing tree, so it
  replaces. This is the only example in the suite that declares it `true`.

Note the template writes `class`, not `className`. Zintl reads both — the shared
`convertToHtmlTemplate` maps one to the other and leaves the other alone — which
is why one helper serves React, Preact and Solid.
