---
"@zintljs/compiler": patch
"zintljs": patch
---

Stop a hot update from double-mounting a React entry.

Two defects produced one symptom, and both are fixed.

A sibling stylesheet was being repointed onto its component in Vite's module graph: the fallback scan
that matches modules to boundaries compares with file extensions stripped, so `src/App.css` matched
`src/App.tsx` and went out as part of that boundary's update. An extension-blind match now requires
the candidate to be a file Zintl extracts from at all. This confirms and closes a hypothesis open
since proposal 027 §2.4.

And React now declares, through the new `reactRuntimeFacet`, that re-running its entry is not safe —
`createRoot()` on a container it already owns mounts a second root over the first rather than
replacing it. Svelte has declared the same thing since the field existed; React could not until
framework detection stopped guessing React for projects that never mention it.

Measured on `react-basic` across sixty edits: six double mounts before, one after. No cost on Rspack,
verified against a real `rsbuild dev` — hot updates there are unchanged.
