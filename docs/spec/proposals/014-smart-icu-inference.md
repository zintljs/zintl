# Proposal 014: Smart ICU Inference (AST Pattern Detection)

## Context

Current Zintl extraction is "Fragment-First." If a developer writes a ternary for pluralization:

```typescript
<div>{count === 1 ? "Item" : "Items"}</div>
```

The extractor currently creates two separate stitched units. This requires the translator to translate "Item" and "Items" in isolation, losing the logical connection. While `@zintl-pass` allows manual context injection, it’s a manual burden.

## Proposed Logic Transformations

### 1. Conditional Pattern Recognition (Extractor)

The `ExtractionContext` should be upgraded with a "Pattern Refiner" phase. During AST traversal, if it encounters a `ConditionalExpression` (ternary) or a `LogicalExpression` where both branches contain translatable strings, it should attempt to merge them into a single **Synthetic ICU Message**.

**Input**: `count === 1 ? "Item" : "Items"`
**Inferred ICU**: `{count, plural, one {Item} other {Items}}`

### 2. Variable Normalization Upgrade

The existing `{input}` variable system should be extended to support "Pattern Binding." The extractor would identify the condition variable (`count`) and automatically include it in the variables map for the transformed `t()` call.

### 3. Integrated JSON Schema

The generated JSON schema will then show the full ICU-like string, allowing translators to use standard pluralization rules for their target languages (which might have 6 plural forms, unlike English's 2).

## Expected System Proofs

- **Source Purity**: Developers write standard JavaScript/TypeScript ternaries without special "TranslatePlural" wrapper components.
- **Translator Clarity**: Translators see the full pluralization logic in a single key, preventing "Disconnected Translation" errors.
- **Zero-Runtime Overhead**: The compiler bakes the correct ICU logic into the manager, and the runtime handles the branch selection efficiently.
