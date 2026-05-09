# Proposal 002: Strict Compilation Mode (Zero-Tolerance Translation Coverage)

## Status

**Proposed**

## Abstract

Zintl current philosophy is "No Mixed Locales," achieved by returning empty strings for missing translations. While this prevents English leaks, it still allows "partially broken" UIs to ship. This proposal introduces a **Strict Compilation Mode** that enforces 100% translation coverage by breaking the build if any used key lacks a target translation.

## Motivation

For production-grade applications, shipping empty strings is often just as unacceptable as shipping the wrong language. We want to treat "Missing Translation" as a **Compiler Error**, equivalent to a syntax error or a missing import. This ensures that the application is fully localized before it ever reaches a staging or production environment.

## Design

### 1. Configuration

A new option `strict: boolean` (defaulting to `true`) in `ZintlOptions`.

```typescript
const compiler = new ZintlCompiler({
  sourceLocale: "en",
  locales: ["en", "ar"],
  strict: true, // Enable build-break behavior
});
```

### 2. Validation Trigger

The validation happens during `compiler.flush()` and `compiler.build()`:

1.  **Key Discovery**: The compiler calculates the intersection of `internalManifest` (all active keys in code) and `userCatalogs`.
2.  **Missing Detection**: For every locale in `locales` (excluding `sourceLocale`), the compiler checks if any key in the manifest is missing or set to `""` in the `.json` file.
3.  **Fatal Reporting**: If gaps are found, the compiler throws a `ZintlValidationError` containing a detailed report of missing keys and their locations.

### 3. Error Reporting Format

The error should be actionable:

```
[Zintl] Strict Mode Validation Failed: 3 missing translations in 'ar'

- "Welcome" in src/components/Hero.tsx
- "Submit" in src/components/Button.tsx
- "Order # {id}" in src/components/Checkout.tsx

Build aborted. Please update your Arabic catalogs before proceeding.
```

### 4. Opt-out Strategy (Escape Hatch)

Strict mode respects `@zintl-ignore`. If a string is ignored, it is not part of the manifest and thus not part of the validation requirement. This remains the official way to intentionally leave content in the source language.

## Implications

- **CI/CD**: Teams can enable `strict: true` in their CI pipelines to prevent merging PRs with incomplete translations.
- **Workflow**: Forces a tighter loop between developers and translators.
- **Micro-frontends**: Can be enabled per-boundary if needed.

## Next Steps

1.  Define `ZintlValidationError` type.
2.  Update `ZintlCompiler.flush` to implement the check.
3.  Add integration tests for build-breaking behavior.
