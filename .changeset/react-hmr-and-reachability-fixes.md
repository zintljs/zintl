---
"@zintljs/compiler": patch
"zintl": patch
---

Fixed React HMR support, nested entry point reachability checks, and documented the synchronous catalog injection behavior:

- Corrected boundary graph reachability traversal (`isReachable`) to resolve file paths against target nodes, fixing HMR invalidation failures for nested/bootstrap anchors.
- Documented the framework-agnostic Synchronous HMR Catalog Injection in `SPEC/ZHMR.md` which leverages Vite's execution order to update the active translation store before component re-renders, rendering manual store subscriptions obsolete.
