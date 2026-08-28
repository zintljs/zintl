---
"@zintljs/compiler": patch
---

Fix a top-level `zintl()` in a `.tsx`/`.jsx` entry never receiving its catalog.

CLAUDE.md defines an entry point as "a file with a **top-level** `zintl()` call". In a `.tsx` or
`.jsx` project that shape did not work: given a module-scope anchor and any string in another
boundary, the generated manager was built for a boundary id that named no chunk. It loaded with a
200 and registered nothing, so the page rendered pseudo-localized in dev and untranslated in a
build.

Normalizing a boundary id — which extensions to strip — was implemented three times.
`IOManager.getNormalizedId` keys the graph, `calculateSafeBoundaryId` mints the ids that reach
emitted code, and both say the same thing: strip `.ts`/`.js` for stability across JS/TS moves, keep
`.tsx`/`.jsx`/`.vue`/`.svelte`. The third copy, inside codegen, also stripped `.tsx`/`.jsx`. So the
graph called a boundary `src/main.tsx` and codegen called it `src/main`.

The fix is that copy's keep-list, now carrying a docblock naming the two implementations it has to
agree with.

**Two accidents hid it.** The strip regex is anchored at end-of-string, so a _function-scoped_ id
(`src/main.tsx:boot`) has no trailing extension and matched the graph untouched — and every example
wraps `render` in `bootstrap()`, which is exactly that case. And the keep-lists disagreed about only
two extensions, so `.ts`, `.js`, `.vue`, `.svelte` and `.html` entries were all fine either way. One
cell of six, reachable only through a shape no project used.

It also needs a _second_ boundary: with every string in the anchor's own file the wrong id is used
consistently on both sides and the page renders correctly.

Guarded now by a matrix asserting that a manager's id names the chunk its boundary actually lands in
— for each extension, at both anchor scopes — and by a contract fixture whose module-scope page is
the one `initial-render` visits. Both were confirmed to fail with the fix reverted; the fixture
reproduces the original symptom exactly.

No output changed for any existing project: 30 projects across two hosts, 386 contract tests, zero
snapshot diff. Emitted ids do move for a project with a module-scope `.tsx` anchor — those projects
were broken, so this is the fix rather than a break.

Written up, including the two things its own plan had wrong, in
`docs/spec/proposals/036-one-boundary-id-spelling.md`.
