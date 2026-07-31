---
"@zintljs/compiler": patch
"zintl": patch
---

Expanded SSR entry point file extension matching in the compiler presets to support JSX/TSX:

- **SSR JSX/TSX Entry Wrapping**: Added support for `.tsx` and `.jsx` file extensions when detecting and wrapping server entry points inside `runInRequestScope` in the `ssr` and `nextjs` presets.
