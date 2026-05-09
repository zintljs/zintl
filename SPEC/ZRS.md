# Zintl Reference Specification (ZRS)

**Version**: 1.0  
**Status**: Active  
**Mantra**: _I am god tier architect, i know what i am doing, and i can create my own Mantra/s, Autarch!_

---

## §1 — Standard Entities

Every source file is classified by the presence of exactly one set of **Symbolic Markers**.
These markers are mutually exclusive at a given scope (file or function).

| Symbol | Name   | Detection                                                                                       |
| :----- | :----- | :---------------------------------------------------------------------------------------------- |
| **$A** | Anchor | A `zintl(...)` or `loadI18nInstance(...)` call used as a statement (not as a config argument).  |
| **$M** | Marker | A bare `import "zintl"` side-effect import with no named specifiers.                            |
| **$L** | Lazy   | A dynamic `import("./path")` expression creating a code-split point.                            |
| **$S** | Sink   | A UI string assigned to a translatable property (innerHTML, JSX text, title, aria-label, etc.). |
| **$V** | Vassal | A file bearing none of {$A, $M, $L, $H}. It is logic-only source.                               |
| **$H** | Portal | An HTML entry point that projects internationalization state onto the DOM.                      |

> [!NOTE]
> A file may contain **both** $A and $S simultaneously. The $A governs ownership; the $S participates in the catalog. A file may also contain $L alongside any other symbol — $L defines storage partitioning at the _dependency edge_, not the file itself.

---

## §2 — The Anchor Hierarchy ($A-Tiers)

Not all anchors are equal. The argument passed to `zintl(...)` determines the **Tier**, which controls the baking strategy and manager generation.

### §2.1 — $A_{static}$ (Baked Tier)

```js
await zintl("ar");
```

- **Baking**: The compiler inlines the target locale catalog directly into the Smart Manager as a synchronous `case` branch (or a direct return if strictly isolated). Result: **0ms hydration** for the specified locale. In production, the `zintl(...)` call itself is reduced to nothingness to eliminate runtime bloat.
- **Locale Pruning**: A statically-locked boundary and its reachable vassals inherit the locale constraint. Redundant translation catalogs for non-target locales are pruned from both the boundary graph and the disk output (§5.4).
- **Source locale**: If the literal matches `sourceLocale`, the compiler emits a **Passthrough** — sinks are not wrapped in `t()`, they remain as raw strings.

### §2.2 — $A_{dynamic}$ (Governance Tier)

```js
const lang = detectLocale();
await zintl(lang);
```

- **Build-time determinism**: None. The expression is opaque.
- **Baking**: Impossible. The compiler generates a **Lazy Manager** with a `switch` over all configured locales, each lazily importing its catalog chunk.
- **No Passthrough**: Sinks are always wrapped in `t()` because the compiler cannot prove the locale at build time.

### §2.3 — $A_{contextual}$ (Inheritance Tier)

```js
await zintl();
```

- **Build-time determinism**: Deferred.
- **Semantics**: The boundary inherits the locale from the runtime environment (parent Kingdom or global state). It maintains its own **storage isolation** (independent catalog chunk) but does not dictate locale.
- **Manager**: Equivalent to $A_{dynamic}$ — a full lazy lookup table.

> [!IMPORTANT]
> **Tier classification is performed in `observe.ts`** via `parseAnchorLocale()`. A `literal` argType produces $A_{static}$. An `expression` argType produces $A_{dynamic}$. An empty argument list produces $A_{contextual}$. This classification flows through `intent.ts` → `resolve.ts` unchanged.

---

## §3 — Symbiosis Patterns

Every file resolves to exactly one of three **Patterns**. The pattern determines the file's relationship to the translation infrastructure.

### §3.1 — Pattern V: Vassal (Slaves)

**Condition**: The file has no $A, $M, or $L targeting it.

```
Kingdom($A) ──static──▶ Vassal($V) ──contains──▶ $S
```

- **Instance**: Shares the parent Kingdom's `loadI18nInstance`.
- **Storage**: Sinks are merged into the parent Kingdom's catalog chunk.
- **Manager**: No dedicated manager. The parent's manager covers this file.
- **Transform**: Sinks are wrapped in `t(key, params, { _mgr: parentMgr, _bId: parentId })`.

### §3.2 — Pattern C: Colony (Lazy Partition)

**Condition**: The file is reached via `$L` (dynamic import) and contains **no** $A or $M.

```
Kingdom($A) ──dynamic──▶ Colony($V) ──contains──▶ $S
```

- **Instance**: **Inherits** the parent Kingdom's locale and lifecycle.
- **Storage**: **Partitioned** — gets its own lazy catalog chunk.
- **Manager**: The parent Kingdom's Manager includes a lazy `import()` branch for this Colony's catalog.
- **Transform**: Sinks wrapped the same way as Vassals, but the catalog is loaded on-demand.
- **Handshake**: The parent must register the Colony's loader at build time (no "Surprise Colony").

### §3.3 — Pattern R: Kingdom (Autonomous Root)

**Condition**: The file contains $A or $M.

```
($A || $M) ──implies──▶ Kingdom
```

- **Instance**: **Dedicated** `loadI18nInstance`. Fully opts out of parent context.
- **Storage**: Dedicated entry catalog chunk.
- **Manager**: Dedicated Smart Manager virtual module.
- **Transform**: The anchor call is rewritten to `loadI18nInstance({ locale, loaders: { ... } })`. In production for $A_{static}$, it is replaced by `undefined` (Zero-Runtime).
- **Handshake**: Self-hydrating. Must call `await zintl(...)` or equivalent trigger.

---

## §4 — Handshake Axioms

These axioms are **absolute**. They resolve every ambiguity in the system.

### Axiom 1: Intent Precedence

> The presence of $A or $M is an absolute directive for Kingdom promotion, subject only to the Pruning Axiom (§5).

The number of sinks ($S) in a file is **irrelevant** to its Pattern classification. A Kingdom with zero sinks is still a Kingdom — it exists to govern its dependency subtree.

### Axiom 2: Shadowing (Atmospheric Pressure)

> For any sink $S, its owning boundary is the **nearest** entity ∈ {$A, $M, $L} on the graph path from $S back to the application root.

- If $A or $M is encountered first → Sink belongs to that **Kingdom**.
- If $L is encountered first (with no $A/$M in the lazy target) → Sink belongs to a **Colony**.
- If nothing is encountered → Sink belongs to the **nearest parent Kingdom** (Vassal inheritance).

### Axiom 3: Instance Heredity

> A Colony inherits the active locale from its parent Kingdom. When the Kingdom switches locale, all Colonies are re-hydrated. A Colony has no independent locale governance.

### Axiom 4: Discovery Dominance (The DFS Rule)

> In the event of a circular dependency (A ↔ B), ownership is resolved by **lexicographic file path order**. The file with the lower path string is discovered first and becomes the owner.

This ensures deterministic, reproducible builds regardless of file system enumeration order.

### Axiom 5: Specificity Over Heredity (Dictator Supremacy)

> Within a single file: if a top-level $A exists at the module scope, it absorbs ALL nested functional scopes — they share its boundary ID. If NO top-level $A exists, each function containing $A becomes its own independent Kingdom.

**Implementation**: `program.ts` pre-scans for top-level anchors. If found, nested functional anchors are **not** mapped to their own boundary IDs. Their sinks flow into the module-level boundary.

### Axiom 6: Recursive HTML Discovery (The Portal Rule)

> An HTML file ($H$) is promoted to an active internationalized entry point if and only if it leads to at least one Trust Anchor ($A$) in its recursive static dependency tree.

- **Discovery**: The compiler walks all `<script src="...">` tags.
- **Heredity**: If any reachable script contains an Anchor, the HTML file inherits the **Governing Locale** of the winning anchor.
- **Pruning**: If no anchors are reachable, the HTML is treated as a plain asset (no bootstrap, no metadata catalogs).

---

## §5 — The Pruning Axiom (Efficiency Standard)

> A Kingdom or Colony is **Pruned** to Vassal status if it has zero reachable sinks in its entire static and lazy subtree, **unless** it bears the $M marker.

### §5.1 — Formal Rule

```
IF   pattern(file) ∈ {R, C}
AND  reachableSinks(file) == 0
AND  NOT hasMarker(file)
THEN pattern(file) = V   // Downlevel to Vassal
```

### §5.2 — Rationale

Without pruning, an empty anchor like `zintl("ar")` in a utilities file would inject a Manager, a `loadI18nInstance` call, and a catalog chunk — all containing zero translations. This is the "Non-sense Procedure" the pruning axiom eliminates.

### §5.3 — Marker Exception

$M (the bare `import "zintl"`) is exempt from pruning. It represents a **declaration of future intent** — the developer is setting up Kingdom infrastructure for a library or micro-frontend that will receive sinks later (via dynamic composition or framework injection).

### §5.4 — Locale Pruning Axiom (The Isolation Rule)

> A boundary is **Locale-Pruned** for a given locale if that locale is not reachable from any Trust Anchor governing the boundary.

- **Propagation**: Locale constraints flow from Anchors down to their dependencies.
- **Artifact Suppression**: The compiler skips generating disk catalogs and virtual content modules for pruned locales.
- **Defaulting**: If a boundary is reachable from at least one $A_{dynamic}$ or $A_{contextual}$, it defaults to "all" locales (no pruning).

---

## §6 — Formal Resolution Algorithm

This is the executable logic that determines a file's final Pattern. It runs in the compiler's `getChunkRoots()` and `intent.ts` phases.

```typescript
function resolvePattern(fileId: string, graph: BoundaryGraph): Pattern {
  const symbols = extractSymbols(fileId);

  // Step 1: Classify
  let pattern: Pattern = "VASSAL";
  if (symbols.hasAnchor || symbols.hasMarker) {
    pattern = "KINGDOM";
  } else if (isReachedViaDynamicImport(fileId, graph)) {
    pattern = "COLONY";
  }

  // Step 2: Prune (§5)
  if (pattern !== "VASSAL") {
    const reach = countReachableSinks(fileId, graph);
    if (reach === 0 && !symbols.hasMarker) {
      pattern = "VASSAL"; // Downlevel
    }
  }

  return pattern;
}

function resolveAnchorTier(anchor: ObservedAnchor): AnchorTier {
  if (anchor.locale.type === "literal" && anchor.locale.value !== "none") {
    return "BAKED"; // §2.1 — $A_static
  }
  if (anchor.locale.type === "expression") {
    return "GOVERNANCE"; // §2.2 — $A_dynamic
  }
  return "INHERITANCE"; // §2.3 — $A_contextual
}

function shouldBake(file: FileObservation): boolean {
  // Baking is ONLY possible when ALL anchors in the file agree on a static locale
  const staticLocales = file.anchors
    .filter((a) => a.locale.type === "literal" && a.locale.value !== "none")
    .map((a) => a.locale.value);

  if (staticLocales.length === 0) return false;
  return new Set(staticLocales).size === 1; // All agree
}
```

---

## §7 — The Registry Handshake Ledger (RHL)

The RHL is the **contract** between the compiler's build output and the runtime's hydration logic.

### §7.1 — Schema

```typescript
// What the compiler generates (injected into transformed source)
interface HandshakeCall {
  locale?: string; // Present for $A_static, absent for $A_dynamic/$A_contextual
  loaders: {
    [boundaryId: string]: {
      // Hashed boundary ID (e.g., "b_785c57fb4811")
      loader: Loader; // The Smart Manager function
    };
  };
}

// What the Smart Manager returns
type Loader = (locale: string) => SyncCatalog | Promise<AsyncCatalog>;

// Catalog shape
type Catalog = Record<string, Record<string, string>>;
// Keyed as: { [boundaryId]: { [messageKey]: translatedString } }
```

### §7.2 — Manager Generation Rules

| Anchor Tier                    | Source Locale Branch            | Target Locale Branch     | Non-configured Locale | Manager Shape   |
| :----------------------------- | :------------------------------ | :----------------------- | :-------------------- | :-------------- |
| $A_{static}$ (target = source) | **Synchronous inline**          | Pruned                   | `return {}`           | **Branch-less** |
| $A_{static}$ (target ≠ source) | Pruned                          | **Synchronous inline**   | `return {}`           | **Branch-less** |
| $A_{dynamic}$                  | Synchronous (Ghost virtualized) | Lazy `import()` for each | `return {}`           | Full `switch`   |
| $A_{contextual}$               | Synchronous (Ghost virtualized) | Lazy `import()` for each | `return {}`           | Full `switch`   |

### §7.3 — Ghost Mode (Zero-Disk Source Locale)

The `sourceLocale` catalog is **never written to disk**. The compiler virtualizes it from the extraction manifest at build time:

```typescript
// For source locale "en", the compiler generates:
case "en":
  return { "b_abc123": { "Hello": "Hello", "Goodbye": "Goodbye" } };
```

This eliminates the redundant `{ "key": "key" }` JSON file from the developer's workspace.

---

## §8 — Storage Model

### §8.1 — Development Mode (Virtual Catalogs)

- Catalogs are served via Vite virtual modules: `virtual:zintl/content/<locale>/<chunkType>:<boundaryId>`
- JSON files on disk (in `outputDir`) are **editable by translators** — the compiler reads them back during `flush()`.
- `$schema` tags are injected into JSON files to enforce key validity.

### §8.2 — Production Mode (Chunk Catalogs)

- Entry chunks: All statically reachable boundary catalogs merged into one.
- Lazy chunks: Individual boundary catalogs, loaded on-demand.
- Shared chunks: Boundaries reachable from multiple entries, deduplicated.

### §8.3 — Catalog Format Tokens

The `catalogFormat` option controls disk layout:

```
"[locale]/[dir]/[name].json"  →  "ar/src/main.json"
"[locale]/[hash].json"        →  "ar/b_785c57fb4811.json"
```

### §8.4 — HTML Projection Catalogs

HTML metadata (title, description, dir) is stored in localized JSON files alongside source catalogs.

- **Format**: `<filename>.<locale>.json` (e.g., `index.html.ar.json`).
- **Persistence**: These files are maintained on disk and editable by translators. The compiler reconciles them during `flush()`.

---

## §9 — Lifecycle Resilience (The Ghost Protocol)

### §9.1 — Failure Model

If a Kingdom fails to fetch a remote catalog (network error, 404, timeout):

1. **Ghost Mode**: Render source-locale strings immediately. The UI is never blank.
2. **Retry**: Exponential backoff (1s, 2s, 4s).
3. **Abandon**: After 5000ms total, log a diagnostic and remain in Ghost Mode.

### §9.2 — Synchronous Boost

If a Manager's loader returns a **synchronous value** (not a Promise), the runtime merges catalogs immediately — no async tick, no flash of untranslated content.

### §9.3 — HMR Behavior (Development Only)

When a source file changes:

1. The compiler re-runs `observe → intent → resolve → apply` for the changed file.
2. The boundary graph and chunk graph are rebuilt.
3. Virtual module invalidation triggers the runtime to re-fetch affected catalogs.

---

## §10 — Conflict Resolution Summary

| Scenario                                 | Resolution Rule               | ZRS Reference |
| :--------------------------------------- | :---------------------------- | :------------ |
| Two anchors in one file (both top-level) | First anchor wins (DFS order) | Axiom 4       |
| Top-level + nested functional anchor     | Top-level absorbs nested      | Axiom 5       |
| Circular dependency (A ↔ B)              | Lexicographic path order      | Axiom 4       |
| Kingdom with zero sinks                  | Pruned to Vassal (unless $M)  | §5            |
| Colony with its own $A                   | Promoted to Kingdom           | Axiom 1       |
| Dynamic import of a file with $M         | Kingdom (not Colony)          | Axiom 1       |
| Non-ESM environment                      | Global Vassal fallback        | §10.1         |

### §10.1 — Environmental Fallback (The Global Vassal)

In environments where static analysis fails (legacy CJS, eval'd code, non-module scripts), ZRS cannot determine boundaries. The system defaults to a single `global` boundary containing all extracted sinks. Performance is sacrificed for correctness.

---

## §11 — Resolution Table (Quick Reference)

| Source Pattern | Symbol Chain              | Resulting State     | Hydration     | Storage         |
| :------------- | :------------------------ | :------------------ | :------------ | :-------------- |
| Single entry   | `main($A) → $V → $S`      | Monolith            | Main governed | Single chunk    |
| Code-split     | `main($A) → $L → $V → $S` | Colony              | Main governed | Lazy chunk      |
| Micro-frontend | `main($A) → sub($A) → $S` | Kingdom             | Isolated      | Dedicated chunk |
| Library marker | `main($A) → lib($M) → $S` | Kingdom             | Isolated      | Dedicated chunk |
| Empty anchor   | `main($A) → util($A) → ∅` | Pruned Vassal       | None          | None            |
| Library stub   | `main($A) → lib($M) → ∅`  | Kingdom (preserved) | Isolated      | Empty chunk     |
| HTML Entry     | `index($H) → main($A)`    | Portal (Sync)       | Self-governed | Projection JSON |
| Asset HTML     | `index($H) → main($V)`    | Plain Asset         | None          | None            |

---

## §12 — Glossary

| Term              | Definition                                                                                                                                |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Baking**        | Compile-time inlining of a translated string directly into the source, replacing the `t()` call entirely.                                 |
| **Passthrough**   | Source-locale optimization where the original string is preserved as-is (no `t()` wrapper).                                               |
| **Smart Manager** | A generated loader function with a `switch` statement that returns synchronous catalogs for known locales and lazy `import()` for others. |
| **Ghost Mode**    | Runtime fallback that renders source-locale strings when the target catalog is unavailable.                                               |
| **Pruning**       | Build-time elimination of empty Kingdom/Colony infrastructure to avoid dead code.                                                         |
| **Handshake**     | The set of boundary loaders registered by a Kingdom's `loadI18nInstance` call.                                                            |
| **RHL**           | Registry Handshake Ledger — the contract schema between compiler output and runtime.                                                      |

---

## §13 — HTML Internationalization ($H$)

HTML files are **Portals**. They project the application's internationalization state onto the DOM metadata (title, description, and direction).

### §13.1 — Metadata Projections ($P$)

The compiler extracts a **Projection ($P$)** from the HTML source:

- **Title**: The content of the `<title>` tag.
- **Description**: The content of the `<meta name="description">` tag.
- **Direction**: The value of the `dir` attribute (or inherited from locale defaults).

### §13.2 — Hybrid Transformation Strategy

HTML transformation follows the tier of the **winning anchor** in its script tree:

- **Baked Transformation ($H_{static}$)**: For literal anchors, the compiler mutates the HTML source during the build process, replacing metadata with translated strings. Result: **0ms hydration**.
- **Dynamic Transformation ($H_{dynamic}$)**: For expression-based anchors, the compiler injects a **Bootstrap Script** (`id="zintl-projection"`) at the end of the `<head>`.

### §13.3 — The Bootstrap Protocol

The injected bootstrap ensures high-fidelity synchronization:

1. **Originals Capture**: Captures the initial title and description before any modification.
2. **Persistence**: Reads `localStorage['zintl-locale']` to apply the last-known locale immediately.
3. **Runtime Handshake**: Exposes `window.__zintlApplyHtml(locale)`, which the `@zintl/runtime` calls during `setLocale` to sync the DOM metadata.
4. **Source Restoration**: If switching back to the `sourceLocale`, the bootstrap restores the captured originals to prevent metadata loss.

### §13.4 — Catalog Preloading (The God Tier Enhancement)

To eliminate the latency gap between application startup and translation hydration, Zintl implements **Dynamic Catalog Preloading**. This ensures that the translation chunks for the active locale are already in the browser's cache (or actively downloading) by the time the runtime calls `await zintl()`.

1. **Post-Rollup Analysis**: During the production build, the Vite/Webpack plugin performs a `post` transformation on the HTML. It scans the final **Rollup Bundle** to identify the hashed filenames of all virtual content chunks (`virtual:zintl/content/<locale>/*`).
2. **Preload Mapping**: The plugin generates a mapping of `locale → [chunkURLs]`.
3. **Bootstrap Injection**: This mapping is injected into the `id="zintl-projection"` script.
4. **Execution**: The bootstrap script executes the following logic at the very top of the `<head>`:
   - Detects the active locale ($L$).
   - Appends a `<link rel="modulepreload" href="...">` for every chunk associated with $L$.

Result: **Zero-latency locale hydration** for SPAs, as the browser fetches the dictionary in parallel with the main JS payload.

---

_The roots are deep, the branches are many, do not cut them apart, Symbiosis!_
