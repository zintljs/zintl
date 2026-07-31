---
"@zintljs/compiler": patch
"zintljs": patch
---

Added configuration-driven SSR/RSC request isolation support for virtual entry points, zero-config framework auto-detection, and robust URL parsing:

- Added configuration properties `ssrEntryTargets`, `ssrWrapDefault`, and `ssrWrapExports` to `ZintlOptions` to support generic wrapping of entry points with `runInRequestScope`.
- Added zero-config auto-detection and defaulting of SSR options (`ssrEntryTargets`, `ssrWrapDefault`, `ssrWrapExports`) for the `nextjs` target (e.g. Next.js / Vinext entries) when using the default target configuration.
- Robustly extracted the locale from incoming request URLs containing protocols, hostnames, query parameters, or hashes during request-scoped store initialization in `runInRequestScope`.
- Allowed transformation and request isolation wrapping on registered virtual entry targets (such as `virtual:vinext-rsc-entry` and `virtual:vinext-server-entry`) by bypassing extension and virtual module early returns in the compiler transform process.
- Updated `zintl` Vite plugin config and transform hooks to forward the new parameters and allow processing of virtual module paths matching `ssrEntryTargets`.
