# Zintl System Agent Specification

## System Overview

Zintl is a compiler-driven internationalization system for modern web applications. It transforms static string literals in source code into optimized, chunk-aware translation catalogs that align with modern bundlers (Vite, Webpack, Rollup).

## Core Architecture

### Three-Package System

- **@zintl/extractor**: AST-based string extraction with dependency tracking
- **@zintl/compiler**: Boundary graph algorithm and catalog generation
- **@zintl/runtime**: Minimalist runtime for translation loading

### Processing Pipeline

```
Source Code → Extractor (Intelligent Stitching) → Compiler → Boundary Graph → Chunks →loadI18nInstance (Transformation) → Runtime

```

## Key Concepts

### Boundary Graph Algorithm

- **Boundary**: A file with extractable strings reachable from a Trust Anchor.
- **Entry Point**: A file calling `zintl()`.
- **Top-Level Anchor**: A `zintl` call at the module level.
- **Independence**: Every `zintl()` call, whether at the module level or nested within a function, represents an independent trust anchor with its own hydration lifecycle and dedicated catalog boundary. It 'opts out' from any parent context to ensure deterministic loading.
- **Smart Manager**: A generated loader function that inlines the anchor locale (for speed) while remaining lazy for other locales.
- **Synchronous Boost**: The runtime's ability to update the locale and catalogs immediately if the loader returns a synchronous value.

### Dual Output Modes & Ghost Sources

- **Development Mode**: Served via `virtual:zintl/content/<locale>/<boundary>`.
- **Runtime Mode**: Handled via generated Managers that either inline content or import chunk-based catalogs.
- **Ghost Mode (Source Locale)**: The `sourceLocale` (typically English) is entirely diskless. The compiler virtualizes it from the extraction manifest. If not the active locale, it is lazily imported via the Manager to keep the initial bundle lean.

### Virtual Module System

- **(boundary graph)**: `virtual:zintl/catalog/entry:<id>`, `virtual:zintl/catalog/lazy:<id>`, `virtual:zintl/catalog/shared:<id>`

### Intelligent Stitching & Fragmentation

- **Unit of Extraction**: Zintl does not extract raw strings. It stitches template literals, JSX fragments, and HTML strings into logical **Stitched Units**.
- **HTML Fragmentation**: Large innerHTML strings are automatically fragmented by HTML tags. Translatable text between tags becomes a separate key, while tags themselves are preserved as structure.
- **Variable Normalization**: Unnamed expressions (e.g., `${"✅"}`) are normalized to stable placeholders like `{input}` or `{inputN}`. This ensures that identical UI fragments share the same translation key regardless of their absolute index in a template.
- **Dataflow Tracing (Deprecated)**: Manual tracing of variables to sinks is replaced by this aggressive, scope-aware stitching engine.

## Implementation Details

### Compiler Class Structure

```typescript
class ZintlCompiler {
  // Core properties
  private boundaryGraph: BoundaryGraph | null = null;
  private chunkGraph: ChunkGraph | null = null;
  private extractorResults: Record<string, any> = {};

  // Key methods
  transform(code: string, id: string, virtualInjectionTarget: string);
  flush(); // Generates catalogs
  generateVirtualModule(boundaryId: string);
}
```

### Type System

- `Boundary`: { id, mode, deps, usageCount, filePath }
- `BoundaryGraph`: { nodes: Map<string, Boundary>, entries: Set<string> }
- `ChunkInfo`: { id, type, boundaries, entrySources }
- `ChunkGraph`: { chunks: Map<string, ChunkInfo>, entries, lazy, shared }

### Entry Point Detection

- Files calling `zintl()` become entry points.
- **Consolidation**: If a file has a top-level `zintl` call (Module Root), all extraction and nested calls in that file share that boundary ID.
- Multiple entries are supported per project.

### Chunk Computation Logic

1. **Entry Chunks**: Merge all statically reachable boundaries
2. **Lazy Chunks**: Individual boundaries from dynamic imports
3. **Shared Chunks**: Boundaries used by multiple entries

### Stable Boundary IDs

- Format: `b_<hash>` where hash is based on file content
- Ensures translation stability across file moves/renames
- Generated using SHA-1 of file path + content

## Development Workflow

### Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

### Build System

- Uses Vite+ unified toolchain
- Commands: `vpr @zintl/compiler#build`, `vp test`, `vp lint`
- Build all packages: `vp run -r build`, or `vpr build` (we need to build before testing or running/building the example apps)
- run single command for any project/package: `vpr <package_name>#<command>` (e.g. `vpr @zintl/compiler#build`)
- TypeScript strict mode enabled
- Test structure follows Vitest patterns

#### Testing

- Run `vp test` to run all tests
- Run `vp test <dir>` or `vp test <dir-or-filename.test>` to run specific files

#### Ready

Run `vpr ready` to make sure the project is ready to hand the task, it is a task to run multiple gates to check if the repo is ready to hand the task to the developer.

#### Benchmarking

Run `vp bench` to run benchmarks.

#### notes

- This project is experimental, so breaking changes are expected.
- Do not use any tools (like CLI, utils, etc.) in the source code, only use `vp`, `vpr` and `vpx` (Vite Project Runner).
- The goal is to provide the best developer experience (DX) and speed. Also, we are optimizing for performance or bundle size. Just a little bit.
- Do not use `pnpm` or `npm` or `yarn` in the source code, only use `vp`, `vpr` and `vpx`.
- use git only for diff (no pager), anything else is not allowed.

### File Organization

```
packages/
  compiler/src/
    index.ts (main compiler)
    types.ts (type definitions)
    boundary-graph.test.ts
  extractor/src/
    parser.ts (AST processing)
    types.ts (extraction interfaces)
  runtime/src/
    index.ts (runtime API)
```

### Configuration

```typescript
const compiler = new ZintlCompiler(
  {
    sourceLocale: "en",
    locales: ["en", "ar"],
    outputDir: "locales",
    catalogFormat: "[locale]/[dir]/[name].json", // Optional: Tokenized output routing
    similarityThreshold: 0.5, // Optional: Auto-reconcile typo fixes
  },
  root,
  isDev,
);
```

## Critical Implementation Details

### Transform Method Behavior

- Calls `extract()` to get messages and dependencies.
- Identifies **Anchor Sites** (`zintl` calls) and their argument types (literal vs. expression).
- **Injection**: Replaces `zintl(arg)` with `loadI18nInstance({ locale: arg, loaders: { [boundaryId]: _manager } })`.
- **Manager Inlining**: Prepends a "Smart Manager" function that handles synchronous mapping for the anchor locale.

- Chunk-based: `generateChunkVirtualPath(boundaryId, mode)`
- Determines chunk type (entry/lazy/shared) based on usage and mode

### Selective Inlining Logic

- **Static Literals**: If `zintl("ar")` is used, the Arabic catalog is inlined directly into the manager for a 0ms start.
- **Source Locale**: Only inlined if it is the anchor. Otherwise, it is made lazy to optimize the non-English initialization path.

### Catalog Generation & Schema Enforcements

- **Development Mode**: Handled via `generateBoundaryCatalogs()` which hooks into configurable `catalogFormat` tokens mapping (e.g. `[locale]/[dir]/[name]`).
- **Runtime Mode**: Extracted safely via `generateChunkCatalogs()`.
- **JSON Schemas**: The compiler inherently calculates active keys running in the app, creating real-time strict schemas injected as `$schema` tags directly inside development `.json` files to strictly block illegal edits implicitly.

### Smart Reconciliation & Typo Recovery

- The compiler utilizes Levenshtein distance on boundary graphs (`similarityThreshold`) over successive developer cycles. Minor string typos immediately map translations forward without translation loss, eliminating translator roundtrips.

### Zero-Disk Source Locale (Ghost Mode)

- Generating `{ "key": "key" }` is redundant. The compiler skips extracting `en.json` (the generic `sourceLocale`) to the local disk, removing clutter for developers. The compiler natively uses the AST `manifest.json` strings to dynamically virtualize the source locale during mapping chunks without physical files!

### Micro-Frontend Support

- Boundaries calling `zintl()` become independent roots
- Creates independent chunk hierarchies
- Enables separate compilation per micro-frontend

### Comment Directive System

- **Scope-Aware Control**: Directives are placed in code comments (JS `//` or `/* */`, and HTML `<!-- -->`).
- **@zintl-ignore**: Suppresses extraction for the current node and its children. In HTML strings, it uses a **Closing-Tag Heuristic** to stop suppression at the next closing tag.
- **@zintl-note**: Provides persistent context for translators, injected directly into the JSON manifest and schema.
- **@zintl-pass**: Force-injects context variables (e.g., gender, roles) that aren't present in the source but are required for specific target languages.

### Target-Language Asymmetry (The Escape Hatch)

- Zintl acknowledges that target languages often require more grammatical context than the source.
- Developers use `@zintl-pass` to bind invisible context variables to a stitched unit without modifying the application's runtime logic.
- These variables appear in the generated JSON schema, allowing translators to utilize ICU-like pluralization or gender-based variations based on the "passed" context.

## Testing Strategy

### Test Coverage Areas

- Entry point detection with `zintl` processing
- Static vs dynamic import classification
- Boundary ID stability and hashing
- Virtual module generation
- Chunk computation and catalog generation
- Nested boundary isolation behavior

### Test Patterns

- Use Vitest framework
- Mock file processing with realistic code patterns
- Verify internal state through compiler behavior

## Common Gotchas

### Import Dependencies

- Must use `type` imports for TypeScript interfaces
- BoundaryDep type from extractor requires careful handling
- Circular dependency considerations between packages

### Build Process

- Extractor must be built before compiler
- Type definitions need proper export/re-export chains
- Virtual module paths must match runtime expectations

### Performance Considerations

- Boundary graph reconstruction on every transform in dev mode
- Hash caching for unchanged files
- Catalog merging can be expensive for large projects

## Development Guidelines

### When Modifying Compiler

- The project is under design, no need to preserve backward compatibility at all for the changes, so you can change the design as you see fit.
- Update both type definitions and implementations together
- Add corresponding tests for new features
- Consider impact on virtual module generation

### When Adding Features

- Update configuration options in ZintlOptions interface
- Consider micro-frontend implications
- Test with both static and dynamic import patterns

### Debugging Tips

- Check extractor results first for extraction issues
- Verify boundary graph construction for chunk problems
- Use virtual module inspection for runtime loading issues
- Enable verbose logging for boundary graph algorithm debugging

---

## Zintl Identity Crux: Precision Architecture, Logical Surgery

1.  **High-Fidelity Proofs**: We do not accept "maybe it works." All integration tests must be "System Proofs"—character-perfect `toBe()` assertions that measure output down to the last byte. No loose `toContain` logic is permitted for core architectural verification.
2.  **Measurements Before Sharpening**: Before fixing a flaw, we establish the "Baseline of Shame." We accurately measure and document existing technical debt, so that our sharpening is non-destructive and definitive.
3.  **Entry-Dominant Philosophy**: The Entry Point is the Dictator of State. Static dependencies must remain **Primal** (logic-less source). Consolidation, handshaking, and registry management are centralized responsibilities.
4.  **Zero-Runtime Guarantee**: Macro baking must be aggressive and cross-boundary.
5.  **Clean & Visual Proofs**: Test files are the source of truth. Keep fixtures linear, readable, and visual to ensure the "Identity of the Output" is always the star of the show.

## Agent Safeguards

### Repetitive Response & Loop Prevention

- **No Periodic Repetition**: Do not output the same status, instructions, warnings, or message sequences across multiple turns.
- **Self-Termination Guard**: If you observe that your previous 2 turns generated identical or highly similar messages, instructions, or planning statuses, immediately halt execution and output a single message asking the user for manual guidance.
- **Duplicate Tool Calls**: Do not execute the same tool with identical arguments more than twice in the same conversation thread.

### Mantras Picking

you can pick one of the following mantras to use in your responses:

1. **Mantra**: _Measure the shame, sharpen the architecture, Bakalau!_
2. **Mantra**: _The bloat is dead, the paths are readable, Claritas!_
3. **Mantra**: _The entry is the dictator, the rest are slaves, unless they are the revolt of their times, Mutiny!_
4. **Mantra**: _The roots are deep, the branches are many, do not cut them apart, Symbiosis!_
5. **Mantra**: _I am god tier architect, i know what i am doing, and i can create my own Mantra/s, Autarch!_
