# Proposal 021: Executable Example Specifications (EES)

## Context

The `examples/` directory is the primary gateway for new users. As we refactor the core `compiler` or `vite` plugin, there is a risk that example-specific configurations or edge cases might regress without a dedicated guard. We should leverage the monorepo structure to treat these examples as high-fidelity integration tests.

## Proposed Strategy: "The Live Fixture"

### 1. Harness Expansion

Our existing `packages/vite/src/__tests__/harness.ts` uses an in-memory filesystem (via `memfs`). We should add a `loadFromWorkspace` mode that allows the harness to point to a real directory on disk while still intercepting file reads/writes for testing.

```typescript
const ctx = await createZintlContext({
  baseDir: "../../examples/website",
  mode: "disk-overlay",
});
```

### 2. Contractual Regression Tests

We should create a new test suite, `packages/vite/src/__tests__/examples.test.ts`, which:

1.  Iterates through all folders in `examples/*`.
2.  Dynamically loads the `vite.config.ts` (using `jiti` or a similar loader).
3.  Simulates a `vite build` of the example's `main.ts`.
4.  Asserts that the "Salvation Proofs" (Correct Hashing, Baking, and Handshake) hold true for the example's output.

### 3. Change-Aware Extraction

By connecting the examples, we can also verify that a logic change in the `extractor` doesn't alter the `manifest.json` for the examples in an unexpected way, preventing "Refactor Amnesia" for our public-facing templates.

## Why this is "God-Tier" Design

- **Documentation as Code**: Your examples are guaranteed to work in every release.
- **User Confidence**: When a user copy-pastes from your `examples/website`, they are using code that passes the same rigorous CI as the core engine.
- **Stress Testing**: Public examples often use real-world CSS, complex DOM structures, and third-party libraries that our isolated unit tests might miss.

## Expected System Proofs

- **No Example Rot**: If the core changes, the examples must be updated immediately or the build fails.
- **High-Fidelity Smoke Tests**: A single test run ensures the entire stack (Extractor -> Compiler -> Runtime -> Vite Plugin) works together in a real project structure.
