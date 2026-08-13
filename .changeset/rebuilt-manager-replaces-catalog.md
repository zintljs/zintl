---
"@zintljs/compiler": patch
---

Let a rebuilt manager replace the catalog it registered.

`registerLoader` skipped loading whenever the store already held a catalog for that boundary. That is
correct for the initial load, where the catalog may already have arrived inline — and it also swallowed
the one call that carries new content. A manager module's body runs a second time only because it was
rebuilt, and it then registers a fresh loader closing over a fresh catalog. Skipping that left the
store on pre-edit strings, so every key added by the edit resolved to an empty string, permanently,
since nothing re-runs and there is no source-locale fallback.

A re-registration is now told from a repeat by loader identity: only a rebuild can produce a different
function for the same boundary. Registering the identical loader still short-circuits as before.

Not reachable on Vite, which re-imports the whole module chain with a fresh timestamp so the content
module applies its own catalog first; it surfaced on Rspack, where the manager re-executes on its own.
