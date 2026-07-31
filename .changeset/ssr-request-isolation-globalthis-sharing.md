---
"@zintljs/compiler": patch
"zintljs": patch
---

Shared server-side AsyncLocalStorage and registry store context on globalThis to prevent request context leaks and hydration mismatches across RSC and SSR environments:

- Shared request-scoped `storeStorage` (AsyncLocalStorage), `globalRegistry`, `defaultInstance`, and `currentInstance` on `globalThis` in the runtime compiler store to bridge the RSC and SSR execution scopes on the server.
- Restored standard Vite HMR catalog hot updates by reverting the experimental full-reload trigger for catalog updates.
- Improved the missing key warn log in translation resolver to print the target boundary ID (`targetBId`) instead of the manager ID.
