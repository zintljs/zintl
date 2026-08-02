# Feature Backlog: JSON Schema Auto-Generation and Injection

**View:** Feature requested to enforce deterministic catalog structures without manual oversight, locking translation JSON files from drift or illegal user additions.
**Problem:** Although catalog structures and boundaries are managed cleanly via Zintl internals, end-users (especially translators) must directly edit the `locales` files. This exposes the system to extreme risk: users adding non-existent keys, mistyping keys during translation, or failing to remove keys when developers removed strings from the codebase.
**Affected System Parts:** `packages/compiler/src/index.ts` (`flush()`, `applyReconciliation`, `ensureSchemaAtTop`, `getSchemaPath`).
**Solution:**

1. Implemented a zero-latency `schema.json` auto-generator synchronized perfectly with active extraction manifests.
2. Injected strict boundary schemas containing `"additionalProperties": false` natively.
3. Automatically injected the POSIX relative traversing `$schema` property dynamically directly into every translation JSON file (e.g. `main.en.json` -> `$schema: "../.schemas/main.schema.json"`) during write.
4. Hid logic completely from UI clutter by enforcing `.schemas` internal routing.
   **Notes:**

- The schema logic runs perfectly in parallel with the `similarityThreshold` engine (handling key renames automatically).
- Schema injection uses strict object destruction rules ensuring `$schema` is always indexed precisely at `Object.keys[0]` (perfectly fulfilling convention).
- Because `flush()` processes keys strictly based on the extracted dependency tree real-time, removing a component automatically prunes the active key, seamlessly throwing cross-file IDE schema verification warnings globally across all untranslated arrays!
