# Feature Backlog: Zero-Disk Source Locale (Ghost Mode)

**View:** Feature requested to eliminate rendering redundant `sourceLocale` payload files directly inside the developer workspace.
**Problem:** Generating `{ "Welcome": "Welcome" }` via traditional localization tools forces heavy IO costs on physical disks and creates "Split-Brain" environments. Developers can mistakenly try editing strings inside the generated JSON file rather than the source UI component. Also, standard runtimes sometimes fetch base-locale payloads redundantly.
**Affected System Parts:** `packages/compiler/src/index.ts` (`loadUserCatalog`, `applyReconciliation`, `flush`).
**Solution:**

1. Stripped away English/Source compilation output completely inside `applyReconciliation` and `flush`.
2. Created an AST virtual ghost generation array inside `loadUserCatalog`: if the system queries the source locale, it simply ignores disk parsing and returns `{}` instantly.
3. Leveraged existing virtual module compilers so when they receive `{}` from the source locale handler, they fall right back into synthesizing the memory-resident `msg.text` extraction variable.
   **Notes:**

- `t(hash)` functions perfectly normally because runtime hash dictionaries (`{ "8a10f3c2": "Welcome" }`) are still cleanly synthesized during Vite bundle generation and hot reloaded dynamically.
- Native users accessing a site without language-modifiers literally interact securely against these inline chunks.
- Deleted physical `en.json` assertions from E2E files; verifying that developers now work inside pristine folders where schemas isolate exclusively non-native language target catalogs.
