---
"@zintl/compiler": patch
---

Fix compiler caching of boundary environment registrations in SSR setups. Boundaries are now tracked and added to `ssrBoundaries` or `clientBoundaries` on every transform call, bypassing the compile-time AST observation cache. This prevents false-positive "server-only" HMR reload events during client-side hydration.
