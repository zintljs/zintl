# Backlog Item 008: Enforce No Mixed Locales (Removing Source-Text Fallback)

## Status

**Completed** (Phase 1 Alignment)

## Problem

Previously, the Zintl compiler would fall back to the `sourceLocale` text (e.g., English) if a translation was missing or empty in a target locale catalog (e.g., Arabic). This led to "Mixed Locale" applications, which are considered broken from an i18n perspective. Users in target languages would encounter English snippets, compromising both design integrity and usability.

## Solution

We have eliminated the `Source-Text Fallback` in the compiler's catalog resolution logic (`getCatalogForFullModule`).

- **Target Locales**: If a translation is missing or manually set to `""` in the `.json` catalog, the compiler now returns an empty string (`""`).
- **Source Locale**: The fallback to the source text remains active only when the requested locale is the `sourceLocale` (Ghost Mode), ensuring English text is correctly virtualized from the manifest.
- **Philosophy**: An app that mixes locales is not an i18n app. We explicitly favor "Blank/Missing" over "Wrong Language," forcing developers to address translation gaps.

## Changes

- Modified `packages/compiler/src/index.ts` to replace `|| msg.text` with a strict nullish check and locale-aware fallback.
- Updated the **Zintl Macro Specification** to codify the "No Fallback" policy.

## Next Steps

- Implement "Strict Compilation Mode" (see Proposal 002) to break the build on missing translations.
- Implement "Literal Baking" for RSC to ensure empty strings are correctly optimized away if missing.
