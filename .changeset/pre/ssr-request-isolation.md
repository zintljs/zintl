---
"@zintljs/compiler": patch
"zintljs": patch
---

Added support for Server-Side Rendering (SSR) request context isolation and automatic client-side locale inheritance:

- **SSR Request Scope Isolation**: Integrated compile-time wrapping of the server entry point's exported `render` function inside `runInRequestScope` to prevent request state pollution.
- **Client Locale Inheritance**: Added client-side oracle mechanism to automatically read and hydrate locale from `document.documentElement.lang`.
- **Sequential Runtime Builds**: Updated build commands for packaging compiler runtime targets sequentially, avoiding shared chunk collision in virtual imports.
- **Idempotency Guard**: Added protection in compiler transform to prevent double-wrapping render exports if transformed multiple times during build execution.
- **Redirect Loop Resolution**: Added path check guards in the client-side redirect script to prevent infinite redirect loops on fanned locale endpoints.
- **SSR appType Support**: Bypassed DevServer HTML-interception middleware when Vite configuration specifies `appType: "custom"`, allowing Express/custom SSR servers to manage routing and server-side redirection cleanly.
