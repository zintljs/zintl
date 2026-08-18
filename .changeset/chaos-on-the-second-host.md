---
"@zintljs/testing": patch
"zintljs": patch
---

Run the chaos contracts on Rspack for the first time, and split the capability the measurement
divided.

`chaos` was claimed by four projects, all on Vite. That was a contract limitation rather than a host
one — the catalog lookup had never heard of `src/locales`, where every Rsbuild example keeps its
catalogs — and fixing the lookup did not, on its own, get the claim re-tried. Claimed on six Rsbuild
projects, the result splits exactly along the contract boundary: deleting and corrupting catalogs
under a running Rspack app works on all six; renaming a boundary works on none.

**The reason renaming fails is not the host.** The hot-update trace recorded modified files and not
removed ones, so "the host reported no deletion" and "the deletion was reported and dropped" looked
identical. Traced, the host reports the removal correctly and the boundary is re-registered
seventeen milliseconds after the compiler forgets it — the residual writer already recorded against
Vite, reproduced on a different watcher, a different event API and a different applier. It is
neither host's defect.

So the capability splits into `chaos` and `chaos-boundary`, the way `hmr` split into `hmr`/`hmr-warm`
for the same kind of reason. One capability covering both would refuse all six Rsbuild projects and
record a host-neutral defect as something Rsbuild cannot do.

Also: `boundaryForgotten` failed with "the host's watcher never reported the unlink", which is
measured false on Rspack. It now names both causes and says how to tell them apart.
