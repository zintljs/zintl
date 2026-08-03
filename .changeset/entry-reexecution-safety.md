---
"@zintljs/compiler": minor
"zintljs": patch
---

Let frameworks declare whether re-running an entry is safe, and fix the Svelte double-mount.

Zintl injects `import.meta.hot.accept()` into files that declare a trust anchor — which are the files that mount. Accepting tells the bundler to re-execute the module, and the injected callback only logged, so it claimed the update was handled while the mount ran a second time.

Whether that matters is a property of the framework. Assigning `innerHTML` replaces. Svelte's `mount()` appends a second copy. `chaos-boundary` reproduces the Svelte case exactly: the page renders twice, 14,665 bytes instead of ~7,300, the locale switcher appearing twice, and the heading selector reading the stale copy.

Both blanket answers were measured, and each is wrong for the other half:

- **Always self-accept** double-mounts Svelte on an entry rewrite.
- **Never self-accept** turns every entry edit into a full page reload, which times out `memory-leak` on `vanilla-spa-basic` — twenty sequential entry edits become twenty reloads. (An earlier attempt used `import.meta.hot.invalidate()`, the same thing by another route: it regressed `hmr-hammer` on every project and took the suite from ~75 s to ~127 s.)

So the framework decides, through `RuntimeFacet.entryReexecutionSafe`. `svelteRuntimeFacet` declares `false` and joins the compound preset; everything else keeps the self-accept and keeps its hot updates hot. The flag merges **pessimistically** — one facet declaring re-execution unsafe decides it for the project, because a project containing any non-replayable mount has one, and OR-ing these the usual way would let a safe facet vote away a hazard another facet reported. Absent means safe: the conservative direction is the one that keeps hot updates working, and a framework needing the other has to say so.

**A trap worth knowing before adding any other runtime claim.** React was marked unsafe first — `createRoot()` does throw on a container it already owns, which is what proposal 024 §1.3 recorded. It had to be reverted, because **`FALLBACK_FRAMEWORK` is `"react"`**: a project where no framework is detected is assembled with the React facets, so `vanilla-spa-basic` silently inherited React's runtime claim and began full-reloading on every entry edit. `syntax-recovery` started timing out and the dev-transform snapshot showed vanilla emitting `invalidate()`. Any claim attached to the React facet reaches every framework-less project by default; a runtime constraint has to be worth that reach before it is added there.

React's `createRoot` case is therefore still latent. It is not reproduced anywhere in the suite, and fixing it speculatively cost more than it bought — the honest state is that the mechanism is now understood and the fix is one facet field away once a reproduction exists.

**`chaos-boundary` is fully live — 4 of 4**, no longer `pendingFor` anything; it was skipped entirely three changes ago. Only the Svelte snapshots moved, which is the scope of the change stated as a diff.
