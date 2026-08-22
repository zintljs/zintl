---
"zintljs": patch
---

Refactor Vite plugin hooks (`resolveId`, `load`, and `transform`) to support Vite 6's Environment API (`this.environment`) for SSR detection, while maintaining backward compatibility with Vite 5 using fallback options.
