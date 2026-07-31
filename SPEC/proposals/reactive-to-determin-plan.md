# Formal Semantic Pipeline: From Reactive Chaos to Deterministic Phases

## The Problem

The current Zintl compiler is a **reactive chaos model**:

- The `transform()` method is a **1558-line monolith** that interleaves observation, decision-making, graph construction, baking, and AST mutation in a single pass
- State is **implicit** — flags like `hasTranslatableContent`, `isLive`, `isRegistered`, `isHandledByAnchor` are computed mid-mutation and used to conditionally branch
- The boundary graph is rebuilt **during** transformation (`buildBoundaryGraph()` called 3x in transform!)
- Decisions about **what to inject** (managers, imports, t() rewrites, baking) happen at the same time as **applying** mutations
- Parser-level visitors (bindings, jsx, program) mix **observation** (finding strings) with **intent formation** (generating transforms) in the same traversal

**This makes it impossible to swap Babel for OXC** because behavior isn't encoded in the visitor — it's encoded in the **interplay between** visitors, compiler state, and graph mutations.

---

## The Diagnosis: Where Chaos Lives

### Current `transform()` Flow (Annotated)

```
transform(code, id)
  │
  ├── OBSERVE: extract(code) → messages, anchors, deps     ← Extractor does this (pure)
  │
  ├── DECIDE & MUTATE (interleaved):
  │   ├── Recover old messages from previousManifest        ← Historic state leak
  │   ├── Clear+rebuild internalManifest for this file     ← Side effect mid-flow
  │   ├── Update dependencyGraph, metadataGraph            ← Side effect mid-flow
  │   ├── buildBoundaryGraph() × 2                         ← Rebuilds entire world graph
  │   ├── computeTranslationChunks()                       ← Rebuilds chunk graph
  │   │
  │   ├── IF hasTranslatableContent:
  │   │   ├── Compute requiredImports (t, loadI18nInstance)
  │   │   ├── Modify existing import declarations           ← AST MUTATION
  │   │   ├── Determine bakedLocale (scan anchors)          ← DECISION
  │   │   ├── Inherited Baking from owner (graph query)     ← CROSS-FILE DECISION
  │   │   ├── Universal Manager Injection:
  │   │   │   ├── getBoundaryOwner() → isLiveOwner()        ← Grid of queries
  │   │   │   ├── getManagerUrl()                           ← URL construction
  │   │   │   └── prepend import                            ← AST MUTATION
  │   │   ├── Anchor-specific Manager Injections:
  │   │   │   ├── getStaticDependents() → walk dep graph    ← Full graph walk PER anchor
  │   │   │   ├── For each reachable owner:
  │   │   │   │   ├── isLiveOwner()                         ← Liveness check
  │   │   │   │   ├── getManagerUrl()                       ← URL construction
  │   │   │   │   └── prepend import                        ← AST MUTATION
  │   │   │   └── Rewrite zintl() → loadI18nInstance()      ← AST MUTATION
  │   │   ├── For each transform:
  │   │   │   ├── IF baking: getCatalogForFullModule()      ← Async I/O mid-mutation
  │   │   │   ├── IF not baked: inject _mgr, _bId           ← DECISION + MUTATION
  │   │   │   └── Push to actions list
  │   │   └── Sort actions descending, apply via MagicString ← FINAL MUTATION
  └── Cache result
```

### Key Anti-Patterns Identified

| Anti-Pattern                                     | Location                              | Impact                              |
| ------------------------------------------------ | ------------------------------------- | ----------------------------------- |
| **Graph rebuilds inside transform**              | Lines 911-915                         | O(n²) per-file overhead             |
| **Interleaved decisions + mutations**            | Lines 929-1261                        | Cannot test decisions independently |
| **Async I/O during mutation**                    | Line 1168 (`getCatalogForFullModule`) | Non-deterministic ordering          |
| **Owner resolution during injection**            | Lines 1051-1070                       | Emergent behavior, not planned      |
| **Import manipulation mixed with t() rewriting** | Lines 942-993 + 1194-1217             | Two mutation types compete          |
| **Triple boundary graph build**                  | Lines 911, 914, 751                   | Wasted computation                  |
| **Extractor produces transforms**                | `bindings.ts:101`, `jsx.ts:90`        | Parser couples to compiler intent   |

---

## The New Model: Five Deterministic Phases

```
SOURCE CODE
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 1: OBSERVE
  "What exists in this file?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ↓
  FACTS (FileObservation)
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 2: INTENT
  "What does this file REQUIRE?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ↓
  PLANNED TRANSFORMS (TransformIntent[])
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 3: RESOLVE
  "What is the final agreed plan?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ↓
  FINAL PLAN (ResolvedPlan)
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 4: APPLY
  "Execute the plan!"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ↓
  TRANSFORMED CODE
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 5: VALIDATE
  "Did nothing break?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ↓
  VERIFIED OUTPUT
```

---

## Phase Definitions

### Phase 1: OBSERVE (Read-Only World)

> **Question**: What exists in this program?

**Input**: Source code string + file path
**Output**: `FileObservation` — a pure, immutable fact record

```typescript
interface FileObservation {
  // === String Facts ===
  messages: ObservedMessage[]; // Every extractable text with location

  // === Structural Facts ===
  anchors: ObservedAnchor[]; // Every zintl() call site
  imports: ObservedImport[]; // Every import declaration
  dependencies: ObservedDependency[]; // Static + dynamic imports

  // === Scope Facts ===
  boundaries: ObservedBoundary[]; // File-level + function-level scopes
  directives: ObservedDirective[]; // @zintl-ignore, @zintl-note, @zintl-pass

  // === Metadata ===
  fileId: string; // Relative path without extension
  hasZintlMarker: boolean; // import "zintl" or zintl() present
  contentHash: string; // SHA-1 of file content
}

interface ObservedMessage {
  text: string;
  context: string; // "innerHTML", "title", "Manual", etc.
  location: SourceLocation; // { start, end, line, column }
  boundaryId: string; // Which scope owns this
  variables: ObservedVariable[]; // { name, originalExpr, sourceRange }
  note?: string; // From @zintl-note
  passVars?: Record<string, string>; // From @zintl-pass
}

interface ObservedAnchor {
  location: SourceLocation; // Exact span of zintl(...) call
  scope: "module" | "function";
  boundaryId: string;
  locale: AnchorLocale; // { type: "literal", value: "en" } | { type: "expression", source: "..." }
}

interface ObservedImport {
  source: string; // "zintl", "./utils", etc.
  specifiers: ImportSpecifier[]; // { local, imported, type }
  location: SourceLocation;
  isDynamic: boolean;
}

interface ObservedVariable {
  name: string; // After normalization (input, input2, ...)
  originalName: string; // Before normalization (var0, var1, ...)
  expression: string; // Source code of the expression
  sourceRange: SourceLocation;
}
```

**Key constraint**: This phase is **100% parser-dependent** (Babel today, OXC tomorrow). Everything else is parser-**independent**.

> [!IMPORTANT]
> The `observe()` function is the **only** point where we touch the AST. By making its output a plain data structure (`FileObservation`), the entire rest of the pipeline becomes **parser-agnostic**. This is the critical architectural boundary for OXC migration.

**What changes from today**:

- The current `ExtractionContext` merges observation with intent (it produces `transforms[]` directly). The new observer produces **only facts**.
- Variable normalization (`var0` → `input`) stays here because it's a naming convention, not a decision.
- JSX stitching stays here because it's structural observation — we're answering "what is the stitched text?"
- HTML fragmentation stays here for the same reason.
- What **leaves**: `addTransform()` calls. The observer no longer produces replacement strings.

---

### Phase 2: INTENT (Still No Mutation)

> **Question**: What does this file REQUIRE?

**Input**: `FileObservation` + `WorldState` (manifest, graphs, config)
**Output**: `TransformIntent[]` — a list of desired transformations, not yet validated

```typescript
interface WorldState {
  manifest: Record<string, ObservedMessage[]>;
  dependencyGraph: DependencyGraph;
  metadataGraph: MetadataGraph;
  boundaryGraph: BoundaryGraph; // Pre-computed, NOT rebuilt per file
  chunkGraph: ChunkGraph; // Pre-computed, NOT rebuilt per file
  config: ZintlConfig; // sourceLocale, locales, isDev, etc.
  catalogs: CatalogCache; // For baking lookups
}

type TransformIntent =
  | ImportIntent
  | AnchorRewriteIntent
  | StringReplacementIntent
  | ManagerInjectionIntent
  | BakingIntent;

interface ImportIntent {
  type: "import";
  source: string; // "zintl"
  specifiers: string[]; // ["t", "loadI18nInstance"]
  strategy: "merge" | "prepend" | "replace";
  targetImport?: SourceLocation; // Existing import to merge into
}

interface AnchorRewriteIntent {
  type: "anchor_rewrite";
  location: SourceLocation; // Span of zintl(...) call
  boundaryId: string;
  loaders: LoaderEntry[]; // [{ stableId, safeId }]
  locale?: string;
}

interface StringReplacementIntent {
  type: "string_replacement";
  location: SourceLocation; // Span of original text
  messageId: string;
  originalText: string;
  boundaryId: string;
  ownerId: string; // Resolved owner for _mgr injection
  variables?: { name: string; expr: string }[];
  isInline: boolean; // Fragment within template literal
}

interface ManagerInjectionIntent {
  type: "manager_injection";
  ownerId: string;
  safeId: string;
  stableId: string;
  managerUrl: string;
  reason: "self" | "handshake" | "anchor_reachable";
}

interface BakingIntent {
  type: "baking";
  location: SourceLocation;
  messageId: string;
  translation: string | Record<string, string>; // Plain or conditional
  variables?: { name: string; expr: string }[];
  isInline: boolean;
}
```

**Sub-phases of Intent Formation**:

```
Observation
    ↓
┌───────────────────────────────┐
│ 2a. Message Registration      │  Convert ObservedMessages → message IDs
│ 2b. Ownership Resolution      │  Map each boundary → its Autonomous Root
│ 2c. Liveness Check            │  Determine which owners have live content
│ 2d. Import Planning           │  Decide what runtime imports are needed
│ 2e. Anchor Planning           │  Plan zintl() → loadI18nInstance rewrite
│ 2f. Manager Planning          │  Plan virtual manager import injections
│ 2g. String Replacement Plan   │  Plan t() call replacements (or baking)
│ 2h. Baking Decision           │  If production + static locale → plan bake
└───────────────────────────────┘
    ↓
TransformIntent[]
```

**What changes from today**:

- **Ownership**, **liveness**, and **reachability** queries are computed here, not during AST mutation.
- Baking decisions are made here, including catalog lookups. The intent says _"bake this message to 'مرحبا'"_ — it doesn't apply it.
- The boundary graph and chunk graph are **stable inputs**, not rebuilt per-file. They're computed once in the `WorldState` after all observations are collected.

---

### Phase 3: RESOLVE (Global Consistency)

> **Question**: What is the final, agreed plan?

**Input**: `TransformIntent[]` for a single file
**Output**: `ResolvedPlan` — deduplicated, validated, and ordered

```typescript
interface ResolvedPlan {
  imports: ResolvedImport[]; // Merged, deduplicated import plan
  prepends: ResolvedPrepend[]; // Manager imports to prepend
  rewrites: ResolvedRewrite[]; // Sorted descending by position
  diagnostics: Diagnostic[]; // Warnings/errors from conflict resolution
}

interface ResolvedImport {
  source: string;
  specifiers: string[];
  location?: SourceLocation; // Null = prepend new import
  strategy: "merge" | "replace" | "new";
}

interface ResolvedPrepend {
  code: string; // Full import statement
}

interface ResolvedRewrite {
  start: number;
  end: number;
  replacement: string;
  kind: "anchor" | "string" | "bake" | "quote_convert";
  priority: number; // For same-range conflicts
}

interface Diagnostic {
  severity: "warn" | "error";
  message: string;
  location?: SourceLocation;
}
```

**Resolution Rules**:

| Conflict                                      | Resolution                        |
| --------------------------------------------- | --------------------------------- |
| Duplicate manager imports for same owner      | **Merge** — keep one              |
| t() replacement + Baking intent for same span | **Baking wins** (production)      |
| Multiple anchor rewrites for same location    | **Error** (this shouldn't happen) |
| Manager for non-live owner                    | **Drop** — remove the intent      |
| Import merge into non-existent import         | **Convert** to prepend            |
| Overlapping rewrite ranges                    | **Error** — diagnostic emission   |

---

### Phase 4: APPLY (Mutation Phase)

> **Command**: Apply the plan deterministically!

**Input**: Original source code + `ResolvedPlan`
**Output**: Transformed source code + source map

```typescript
function apply(source: string, plan: ResolvedPlan): TransformResult {
  const ms = new MagicString(source);

  // 1. Apply prepends (manager imports)
  if (plan.prepends.length > 0) {
    ms.prepend(plan.prepends.map((p) => p.code).join("\n") + "\n");
  }

  // 2. Apply import merges/replacements
  for (const imp of plan.imports) {
    // ... merge or replace existing imports
  }

  // 3. Apply rewrites (already sorted descending)
  for (const rewrite of plan.rewrites) {
    ms.overwrite(rewrite.start, rewrite.end, rewrite.replacement);
  }

  return {
    code: ms.toString(),
    map: ms.generateMap({ hires: true }),
    diagnostics: plan.diagnostics,
  };
}
```

**Key constraint**: This phase is **mechanistic**. It contains ZERO decisions. It simply executes the plan. Any tool that can do string slicing (MagicString, OXC's codegen, manual string ops) can implement this.

---

### Phase 5: VALIDATE (Post-Condition Check)

> **Question**: Did nothing break?

**Input**: Transformed code + `ResolvedPlan`
**Output**: Validation report

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

type ValidationError =
  | { type: "missing_import"; name: string } // Used t() but no import
  | { type: "orphan_manager"; managerId: string } // Injected but never ref'd
  | { type: "overlapping_rewrite"; range: SourceLocation }
  | { type: "broken_template"; location: SourceLocation }
  | { type: "unresolved_boundary"; boundaryId: string };
```

**Checks**:

1. Every `t()` in output has a corresponding `_mgr` reference
2. Every `loadI18nInstance()` has its loaders object populated
3. No orphan manager imports (injected but never referenced in handshake)
4. No overlapping rewrites were silently dropped
5. Template literal delimiters are balanced
6. All referenced virtual module IDs resolve to known boundaries

---

## World State Management

The current system rebuilds the boundary graph **inside** every `transform()` call. The new model separates **world state computation** from **per-file transformation**.

```
┌─────────────────────────────────────────────────┐
│                WORLD STATE                       │
│                                                  │
│  ┌──────────────┐   ┌───────────────────────┐   │
│  │ Observation   │   │ Boundary Graph         │   │
│  │ Cache         │──▶│ (computed ONCE after   │   │
│  │ (per-file)    │   │  all files observed)   │   │
│  └──────────────┘   └───────────────────────┘   │
│                            │                     │
│                     ┌──────▼──────────────────┐  │
│                     │ Chunk Graph              │  │
│                     │ (ownership, liveness)    │  │
│                     └─────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Two-Pass Architecture

**Pass 1: Observe All Files** (parallel-safe)

```
for each file in project:
  observations[file] = observe(file.code, file.path)
```

**Between Passes: Compute World State** (serial)

```
worldState = computeWorldState(observations, config)
  → builds manifest
  → builds dependency graph
  → builds boundary graph (ONCE)
  → builds chunk graph (ONCE)
  → computes ownership map
  → computes liveness map
```

**Pass 2: Transform Each File** (parallel-safe)

```
for each file in project:
  intents    = formIntent(observations[file], worldState)
  resolved   = resolve(intents)
  result     = apply(file.code, resolved)
  validation = validate(result, resolved)
```

> [!WARNING]
> **Dev mode caveat**: In Vite's dev server, files arrive one at a time via `handleHotUpdate`. The two-pass model requires an **incremental update** strategy where the world state is patched (not rebuilt) when a single file changes. This is the same problem as before but now **explicitly modeled** rather than implicitly handled by rebuilding everything.

---

## Migration Strategy

### Phase 1A: Define the Type System (No Code Changes)

Create the formal types (`FileObservation`, `TransformIntent`, `ResolvedPlan`) in a new file `packages/compiler/src/pipeline/types.ts`. This is pure type-level work.

### Phase 1B: Extract `observe()` from Extractor

Refactor `@zintljs/extractor` to return `FileObservation` instead of the current mixed `ExtractionResult`. The existing visitors stay — they just write to a cleaner output structure. This is where "transforms" leave the extractor.

### Phase 2: Implement `formIntent()`

Extract the decision logic from `transform()` lines 926-1220 into a pure function that takes `(FileObservation, WorldState) → TransformIntent[]`. This is the biggest refactor — it untangles ownership resolution, liveness checks, and baking decisions from the mutation code.

### Phase 3: Implement `resolve()`

Extract the conflict resolution and ordering from `transform()` lines 1222-1241 into a standalone resolver. Add the diagnostic system.

### Phase 4: Implement `apply()`

This already exists in rudimentary form (the MagicString block). Clean it up into a standalone function that takes a plan and produces code.

### Phase 5: Implement `validate()`

New code. The current system has no post-condition checks — bugs are discovered at runtime. This phase adds safety.

### Phase 6: Wire It Together

Replace the old `transform()` with the new pipeline:

```typescript
async transform(code: string, id: string): Promise<TransformResult | undefined> {
  const observation = observe(code, id, this.config);
  this.updateWorldState(observation);

  const intents = formIntent(observation, this.worldState);
  const plan = resolve(intents);
  const result = apply(code, plan);
  const validation = validate(result, plan);

  if (!validation.valid) {
    for (const err of validation.errors) {
      console.error(`[Zintl] ${err.type}: ${err.message}`);
    }
  }

  return result;
}
```

---

## Why This Enables OXC Migration

| Concern           | Current State                                               | After Pipeline                                                  |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Parser dependency | **Everywhere** — Babel types in visitors, context, compiler | **Phase 1 only** — `observe()` touches the AST                  |
| Swap cost         | **Rewrite everything** — visitors, context, transforms      | **Rewrite `observe()`** — everything else stays                 |
| Testing           | Need Babel + full compiler to test anything                 | Test phases independently with plain data                       |
| Parallelism       | Impossible — `transform()` mutates shared state             | Observe is parallel, Intent is parallel, Apply is parallel      |
| Debugging         | "Why did this import appear?" → trace through 1558 lines    | "Why?" → check intent at line N, trace to observation at line M |

---

## Open Questions

> [!IMPORTANT]
> **Dev Mode Incrementality**: The two-pass model (observe-all → compute-world → transform-all) works for production builds. For dev mode, do we:
>
> 1. Rebuild world state on every file change (simple but O(n))?
> 2. Maintain incremental world state with dirty-tracking (complex but O(1) amortized)?
> 3. Keep the current single-pass approach in dev mode with a "dev-observe" that also does intent? (pragmatic hybrid)

> [!IMPORTANT]
> **Extractor Independence**: Should `observe()` be part of `@zintljs/extractor` or a new package? The extractor currently does Babel parsing + visiting. If we move to OXC, do we want `@zintljs/extractor-babel` and `@zintljs/extractor-oxc` that both produce `FileObservation`?

> [!IMPORTANT]  
> **Baking I/O**: The current baking logic does async `getCatalogForFullModule()` during mutation. In the new model, this happens in Phase 2 (Intent). But Phase 2 should be pure/fast. Should we pre-load all potentially-needed catalogs into `WorldState` before Phase 2, or accept that Intent formation is async?

## Verification Plan

### Automated Tests

- Each phase gets its own test file with pure input→output assertions
- `observe.test.ts`: Source code → `FileObservation` snapshots
- `intent.test.ts`: `FileObservation` + mock `WorldState` → `TransformIntent[]`
- `resolve.test.ts`: `TransformIntent[]` → `ResolvedPlan` (conflict resolution)
- `apply.test.ts`: Source code + `ResolvedPlan` → transformed code (`toBe()` exact match)
- `validate.test.ts`: Transformed code + plan → validation errors
- All existing integration tests (client-spa, world-class-scenarios) must produce **identical output** after migration

### Manual Verification

- Run the example apps to verify runtime behavior
- `vp test` must pass 100%
