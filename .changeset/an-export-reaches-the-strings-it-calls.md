---
"@zintljs/compiler": patch
---

Fix strings reached through an exported function never arriving in any catalog chunk.

A module whose strings live in one function and whose entry point imports another — the shape every
data module takes — shipped empty:

```ts
function nav() {
  return { sections: [{ title: "Guide" }] }; // sinks land on `src/nav:nav`
}
export function getSections() {
  return nav().sections; // the boundary an importer resolves to
}
```

The catalog was written to disk and filled, `verifyIntegrity` passed because the file was complete,
and the titles rendered pseudo-localized in dev and **empty in production**. A missing translation
is supposed to fail your build; this one passed it.

`GraphManager` drops a boundary that has no strings of its own, no anchor, and no dependencies,
keeping only those that can serve as pass-throughs to content further down. The dependency test asked
the **file's** imports — and `src/nav` imports nothing, so `src/nav:getSections` was deleted as a
leaf. It was not a leaf: `internalDependencies` already recorded `getSections → nav`, the very edge
that reaches the fourteen strings. Every walk over the boundary graph then hit a dependency with no
node behind it and stopped there.

The guard now counts internal edges as dependencies, which is the case the rule already meant to
keep — it was simply asking the file instead of the boundary.

Surgical reachability is untouched: an export still reaches only what it calls, and a module-level
string nothing reads is still left out of the entry catalog. In the suite this adds one intermediate
node to `vanilla-ssr`'s graph and gives it an owner; no chunk lost a boundary.
