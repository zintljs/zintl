---
"zintljs": patch
"@zintljs/compiler": patch
---

Fix production SSR client hydration mismatch and Vue SFC multiplex caching:

- Virtualize Vue and Svelte SFC paths by locale (e.g. `HelloWorld.zintl-ar.vue`) in `resolveIdHook` and `loadHook` to prevent descriptor caching collision in the SFC compilers.
- Normalize localized virtual SFC paths back to clean original paths in `packages/compiler/src/managers/IOManager.ts`.
- Allow relative imports within virtualized `.zintl-` SFCs to propagate their locale and get virtualized rather than returning raw clean paths immediately.
- Skip processing Vue and Svelte virtual sub-requests in `loadHook` and `transformHook` to prevent overriding pre-compiled blocks with raw template blocks.
- Trim catalog key matching and variable mustache lookups with padding preservation in the compiler pipeline to ensure translations match and preserve leading/trailing whitespace.
