---
"@zintljs/compiler": patch
"@zintljs/testing": patch
"zintljs": patch
---

Name the host's half of ZHMR §4.2's routing, and run the structural HMR path on six more projects.

`hmr-structural` was claimed by two projects, so §4.1③ (a new sink) and §4.2 (a new anchor) had never
run on Vue, on Svelte, or on Rspack — and §4.2 is the section whose two-route rule was written from
that sample of two. Extending it to Vue and Svelte on Vite, and React, Vue, Svelte and vanilla on
Rspack, found the missing input immediately.

**`BundlerFacet.absorbsStructuralChange`.** §4.2 routed a structural change by asking the entry:
where re-running it is safe, the re-executed entry rebuilds the boundary map in place. That is a
framework fact, and it is not the whole answer — a new boundary is a new catalog chunk, and a host
that answers a changed entrypoint chunk set with a full reload does so before Zintl is consulted.
Measured: `plan.fullReload` is `false` for exactly the edits that reload on Rspack. The new flag
defaults to `true`, is declared `false` by `rspackFacet`, and merges pessimistically like
`entryReexecutionSafe`; the two compose into one question the contract asks once.

**`hmr-warm` gates the no-reload claim.** The warm half of the structural contract was asserting a
guarantee the contract did not require, so projects that reload for every edit — documented, measured
behaviour since the capability was created — were failing it. That assertion is now its own contract,
selected by capability rather than branched on inside one.

No runtime behaviour changes for existing users; this names a host difference that was already there
and was being attributed to the framework.
