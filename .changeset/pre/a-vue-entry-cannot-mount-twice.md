---
"@zintljs/compiler": patch
---

Stop a Vue entry re-mounting itself into a blank page.

The Vue runtime facet left `entryReexecutionSafe` at its permissive default, on the stated reasoning
that "Vue's mount is replayable where React's `createRoot` and Svelte's `mount` are not". It is not.
The difference from React is only in how loudly it fails.

`createApp(App).mount("#app")` builds a **new application instance** every time it runs. On a
container that already has one, Vue's DOM mount clears `innerHTML` and renders the new app into it,
and never unmounts the old one — whose reactive effects are still scheduled and still hold
references to the nodes just removed. React throws on a container it already owns; Vue warns, wipes
the page, and then dies in the first effect reaching for a `nextSibling` that is no longer there.

Measured on a Vue documentation site: editing a localized `.md` artifact invalidates each boundary's
source module — an asset edit is deliberately not treated as a hot catalog edit, because a URL asset
bakes its resolved URL into the source — so the entry re-ran, mounted a second app, and the page
went empty until a manual reload. Reproduced on an unmodified checkout before anything was changed.

With the flag declared, such an entry accepts and immediately invalidates, and the update bubbles to
a reload: the edit is shown rather than swallowed. That cost is exactly what the flag exists to
trade for, and it is the trade React, Svelte, Lit and Solid already make.

Preact keeps `true` and is right to — its `render(vnode, container)` diffs into the same container
rather than constructing a second root. The flag is about that distinction.

No behaviour changed for any non-Vue project. Across the suite this moves two dev-transform
snapshots and the `entryReexecutionSafe` line of sixteen facet compositions; every HMR contract
passes unchanged.
