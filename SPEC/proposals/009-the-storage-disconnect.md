# Proposal 009: The Storage Disconnect (Resolving Asymmetric Context)

## Context

Zintl achieves high-fidelity identity via **Salvation Hashing**, which consumes the source text, the UI context (e.g., `innerHTML`), and the `@zintl-note` to generate a unique SHA-1 ID. However, the current translation storage layer (`.json` files) keys exclusively by raw text:

```json
{
  "Save": "إرسال"
}
```

This creates a "Storage Disconnect": if a developer has `t("Save", { note: "File" })` and `t("Save", { note: "Person" })`, the compiler generates two unique hashes, but both look up the same `"Save"` key in the JSON file. We cannot currently provide different translations for identical source strings.

## Proposed Logic Transformations

### 1. Context-Aware JSON Keys

We should transition to a storage format that allows for context-specific overrides while maintaining human readability.

**Option A: The Semantic Path (Recommended)**

```json
{
  "Save": {
    "_default": "إرسال",
    "File": "حفظ",
    "Person": "إنقاذ"
  }
}
```

**Option B: The Shadow Hash**

```json
{
  "Save [hash1]": "حفظ",
  "Save [hash2]": "إنقاذ"
}
```

### 2. Compiler Resolution Upgrade

The `ZintlCompiler.loadUserCatalog` method currently does a shallow merge. It must be updated to handle nested objects or hashed suffixes. When the compiler encounters a message hash, it should first check for a direct match, then fall back to the raw text.

### 3. Schema Enforcement

The `$schema` generation in `safeGenerateSchema` must be updated to reflect these nested context requirements, allowing translators to see the `@zintl-note` as part of the JSON structure itself.

## Expected System Proofs

- **Asymmetric Translation**: Developers can provide different Arabic translations for the same English string by simply changing the `@zintl-note`.
- **Backward Compatibility**: Existing flat JSON catalogs continue to work as "Default" overrides.
- **Readable Catalogs**: Translators can see the developer's intent (the note) directly in the translation file.
