---
"@zintl/compiler": patch
---

Fixed boundary resolution and dependency reachability for exported bindings and entry point content modules.

- Registered candidate boundaries defined in `exportedBoundaries` (e.g. `src/main:createApp`) into the compiler's boundary graph, ensuring that static reachability traversal chains are not broken by named exports.
- Expanded entry-point content catalog generation (for target locales like `ar`, `es`, `zh`) to always inline and collect all statically reachable boundaries, aligning their structure with the manager's source locale catalog.
