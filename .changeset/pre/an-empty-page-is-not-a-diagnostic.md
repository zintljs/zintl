---
"@zintljs/compiler": minor
"zintljs": minor
---

Show untranslated strings as `⟦Ẇéļçöṁé ƀàçķ!⟧` while serving, instead of blanking the page.

Catalogs start empty. `verifyIntegrity` is off while serving by design, and a missing key resolves
to `""`. So the first thing a new project did, on the very first locale switch, was **empty itself**
— every string gone, no error, no warning on the page, nothing in the terminal. The dev server is
where someone decides whether to keep this package, and what it showed them was a blank app.

The build error was fixed in the same release. This is the other half, and the worse half: a build
failure at least says something.

`pseudoLocalize` (default `true`) renders a miss as visibly-untranslated text:

```
⟦Ýöü ĥàṽé 3 ñéẁ ṁéššàĝéš⟧
```

**This is not a fallback to the source locale.** That rule is not bending, and the design is what
keeps it from bending:

- The text is unmistakable. Nobody reads `⟦Ẇéļçöṁé⟧` as a translation, nobody ships it, and nobody
  builds the habit of a dev app that looks finished. A placeholder that could pass for a translation
  would be a source fallback wearing a costume.
- It cannot reach production. The branch sits inside `__ZINTL_DEV__`, and `getRuntimeCode` folds
  `__ZINTL_PSEUDO__` to a literal `false` for every build — so the guard, the branch and
  `pseudoLocalize` itself are all eliminable, and the rule that nothing ships unused holds.
- The build still fails. `verifyIntegrity` is unchanged and refuses the same set of strings.

Two details that decide whether this is useful or merely visible.

**Placeholders and markup are preserved.** `{count}` is read back by `interpolate`, `<t0>` by the
tag restoration after it; accenting either would turn a visible placeholder into a broken one. The
transform splits on both and leaves them alone.

**The pseudo string falls through rather than returning early**, so it goes through interpolation and
tag restoration like any real message. `{count}` shows the real count and markup renders as markup —
the layout stays honest and only the words announce themselves. Returning early would have produced
a page full of literal `{count}` and `<t0/>`, which tests nothing about your layout.

Four unit tests asserted the old empty string on the miss path and now assert the marked one. A fifth
that looked similar was left alone on purpose: a catalog entry present but non-string still returns
`""`, because that is a different branch and a different bug.

**The build-output snapshots earned their keep here.** The obvious way to write the miss path — assign
in the dev block, re-test `message` after it — folds to a redundant `if (message === void 0)` nested
inside its own `if (message === void 0)`, in every shipped bundle. The dev branch disappears; the
extra test does not. It is invisible in the source and obvious in the snapshot diff, which is exactly
what those snapshots are for. The `else return` shape now carries a comment saying so, because the
natural way to write it is the wrong way.

One asymmetry worth knowing, measured rather than assumed. With minification off — which is how the
contract harness builds, so the snapshots stay readable — Rollup drops the now-unreferenced
`pseudoLocalize` and its two tables, and **Rspack does not**: it defers unused top-level bindings to
the minifier. Every real production build minifies, and `examples/*/dist` is clean of all four
symbols on both hosts, so nothing reaches a user either way. But the Rsbuild snapshots do show them,
and that is a tree-shaking gap rather than a leak. Closing it properly means giving the helper its
own runtime module and serving an empty one when not in dev, the way `store-client` and
`store-server` are already composed — deliberately not done here, for a dev-only affordance.
