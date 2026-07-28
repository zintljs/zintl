---
"@zintl/compiler": patch
"zintl": patch
---

Ensure deterministic boundary and chunk graph serialization by implementing deterministic sorting helpers:

- **Deterministic Serialization**: Added the `serializeDeterministic` utility to recursively format and sort `Map` keys, `Set` elements, and arrays of objects (such as `BoundaryDep` lists) by stable properties (e.g. `id` or `name`).
- **Strict ESLint Compliance**: Included a localized string comparison helper `compareStrings` to satisfy array sort checks without the performance overhead of Unicode-based `localeCompare`.
- **Contract Tests Snapshot Stability**: Updated the contract graph test suite to utilize the new deterministic serializer, preventing random reordering failures on successive test runs.
