---
"@zintl/compiler": patch
---

Refactored the adapter resolution engine to introduce a unified flat contribution union (`ZintlAdapter`) and a recursive `ZintlAdapterInput` configuration structure. Cleaned up legacy configuration backward-compatibility fallbacks, eliminated `any` type overrides in resolution functions, and migrated test configurations to use official system presets directly rather than duplicating custom mock adapters.
