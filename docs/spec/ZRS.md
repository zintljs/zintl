# Zintl Reference Specification (ZRS)

**Version**: 1.0  
**Status**: Active

---

## §1 — Standard Entities

Every source file is classified by the presence of exactly one set of **Symbolic Markers**.
These markers are mutually exclusive at a given scope (file or function).

| Symbol  | Name   | Detection                                                                                      |
| :------ | :----- | :--------------------------------------------------------------------------------------------- |
| **$A**  | Anchor | A `zintl(...)` or `loadI18nInstance(...)` call used as a statement (not as a config argument). |
| **$M**  | Marker | A bare `import "zintljs"` side-effect import with no named specifiers.                         |
| **$L**  | Lazy   | A dynamic `import("./path")` expression creating a code-split point.                           |
| **$S**  | Sink   | A string occupying a position declared translatable by a **target**. Formalized in §15.        |
| **$V**  | Vassal | A file bearing none of {$A, $M, $L, $H}. It is logic-only source.                              |
| **$H**  | Portal | An HTML entry point that projects internationalization state onto the DOM.                     |
| **$AS** | Asset  | A static asset (.txt, .md) that participates in the localization pipeline.                     |

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

### §2.4 — $A_{sovereign}$ (Sovereign Tier)

```js
// At the application root / entry module:
await zintl("*");
```

- **Build-time determinism**: Compiler-Governed.
- **Semantics**: When `zintl("*")` is located at the root module of a Portal-linked entry, it asserts full Sovereign control. It instructs Zintl to take over routing, entry partitioning, and the hydration topology.
- **Baking**: Operates with the exact same 0ms runtime overhead as `$A_{static}$`, fanning out static-baked standalone outputs for each locale natively via the compiler's transform pipeline based on the multiplex context.
- **Rules of Precedence**:
  - **Rule 1**: Sovereign only valid at root kingdom (Root Entry). Nested/subordinate sovereign anchors are illegal and emit a compile-time error.
  - **Rule 2**: MPA sovereignty is per-entry. Individual inputs choose authority models independently.
  - **Rule 3**: Sovereignty dominates contextual descendants. Descendant contextual `zintl()` calls collapse into compile-time static localized boundaries relative to the sovereign branch's targeted locale.

> [!IMPORTANT]
> **Tier classification is performed in `observe.ts`** via `parseAnchorLocale()`. A `literal` argType produces $A_{static}$ (or $A_{sovereign}$ if the literal value is `"*"`). An `expression` argType produces $A_{dynamic}$. An empty argument list produces $A_{contextual}$ representing compositional subtree inheritance. This classification flows through `intent.ts` → `resolve.ts` unchanged.

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

> Wherever ownership is decided by which candidate is reached **first**, the candidates are ordered **lexicographically** — never by discovery order. This covers a circular dependency (A ↔ B), where the file with the lower path string becomes the owner, and equally the root set from which ownership is assigned.

This ensures deterministic, reproducible builds regardless of file system enumeration order.

The second half is not a generalisation after the fact; it is where the axiom was being violated. Chunk roots were iterated in graph-insertion order and ownership went to whichever root reached a boundary first, so a file reachable from two roots could belong to either. Insertion order differs between a compiler starting cold and one reading a saved manifest — the manifest is written with sorted keys — so **the same source produced two different graphs depending on whether a previous build had run.** Any first-wins resolution that is not explicitly ordered is an instance of this bug waiting to be found.

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

$M (the bare `import "zintljs"`) is exempt from pruning. It represents a **declaration of future intent** — the developer is setting up Kingdom infrastructure for a library or micro-frontend that will receive sinks later (via dynamic composition or framework injection).

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

function resolveAnchorTier(anchor: ObservedAnchor, isRootEntry: boolean): AnchorTier {
  if (anchor.locale.type === "literal" && anchor.locale.value !== "none") {
    return "BAKED"; // §2.1 — $A_static
  }
  if (anchor.locale.type === "expression") {
    return "GOVERNANCE"; // §2.2 — $A_dynamic
  }
  if (isRootEntry) {
    return "MULTIPLEX"; // §2.4 — $A_multiplex
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

> **Superseded by [ZDB](ZDB.md) §6.** This section described a source-locale fallback and an
> exponential-backoff retry. Neither was ever implemented, and the first is forbidden: a missing
> translation is a build-time error (`verifyIntegrity`), not a reason to render a different
> language. Kept here because knowing which model was intended, and rejected, is worth more than a
> silent deletion.

If a Kingdom fails to fetch a remote catalog (network error, 404, timeout), the load settles as
`failed` on the `runtime/catalog` channel, naming the boundary and locale. There is no fallback and
no retry — see ZDB §6 for the full outcome table and the reasoning.

<details>
<summary>Original §9.1 (never implemented)</summary>

1. **Ghost Mode**: Render source-locale strings immediately. The UI is never blank.
2. **Retry**: Exponential backoff (1s, 2s, 4s).
3. **Abandon**: After 5000ms total, log a diagnostic and remain in Ghost Mode.

</details>

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

## §14 — Localized Assets ($AS$)

A Localized Asset is a static file — `.txt`, `.md`, `.pdf`, `.webp`, `.mp4`, anything a project targets
— whose content varies by locale. Zintl manages the **slot**, never the content.

> **Localization is not translation.** Translation is one thing that can happen inside a localized
> artifact; it is not the relationship between the artifact and its source. A German legal PDF is not
> derived from the English one, a photograph of the Tokyo storefront is not derived from the Paris
> one, and a dubbed audio track is not a transformation of anything.

### §14.1 — Authored, not derived

- **Targeting**: a file matching `assetsTarget` declares that a slot exists. Targeting _is_ the
  statement that this file varies by locale; an asset identical in every locale is one you never
  target.
- **Scaffolding**: each targeted asset gets an **empty** artifact per non-source locale, under
  `outputDir` beside the catalogs. A person fills it.
- **The compiler MUST NOT copy** content from a source asset into a localized one. A byte-identical
  artifact is a source-locale fallback that nothing downstream can detect, which §5 forbids.
- **The compiler MUST NOT compare** a source asset with a localized one. A source edit does not imply
  a localized change, and for binary content the comparison is meaningless. Whether a translation has
  fallen behind is an editorial question, and belongs to a person or a TMS.

Artifact paths follow `outputPattern` when a target names one, and otherwise
`<outputDir>/<path>.<locale><ext>` — so `src/about.txt` becomes `zintl/src/about.ar.txt`.

### §14.2 — Identity

The one comparison Zintl performs is between a source asset and **its own previous state**, which
answers _"did this move?"_ and never _"is that stale?"_.

| Observed            | Meaning          | Action                                      |
| :------------------ | :--------------- | :------------------------------------------ |
| Same hash, new path | Moved or renamed | Move the artifacts to follow                |
| Same path, new hash | Edited in place  | Nothing                                     |
| New hash, new path  | Ambiguous        | Treat as new; leave the old artifacts alone |

The Hive records a source asset's content hash and the path that last carried it. It stores **no
asset content**: restoring content into an artifact would be copying, whichever direction it came
from. Nothing is ever deleted, so a wrong guess costs an orphaned file rather than unrecoverable
content.

### §14.3 — Delivery

How an artifact's bytes reach the browser is decided by **the import**, not by the file's extension:

| Import                            | Delivery                                               |
| :-------------------------------- | :----------------------------------------------------- |
| `import t from "./about.txt?raw"` | **Inline** — the content becomes the catalog value     |
| `import u from "./hero.webp"`     | **Reference** — the bundler's URL is the catalog value |

Because a URL is a string, every mechanism downstream — chunking, hydration, runtime locale
switching, hot updates — works on a PDF or a video without knowing it is one. No file type is special,
and none needs naming.

### §14.4 — Development Mode (HMR)

In development, assets are mapped to a global **Virtual Boundary** named `b_assets`.

- **Dependency Mapping**: in `isDev` mode, every active entry chunk automatically depends on `b_assets`.
- **Invalidation**: when any registered asset — source or artifact — is modified, the compiler
  invalidates `b_assets`, cascading to all entry points so the UI reflects the change immediately.
- **Unfilled artifacts** are served **empty**, never as the source locale, with one warning per
  artifact naming the file to fill. A dev server is not where a release is decided, and refusing to
  serve a project mid-translation would refuse its normal state.

### §14.5 — Integrity

An unfilled artifact is a missing translation with a file for a body. `verifyIntegrity` — on for
builds, off while serving, the same option and default that governs strings — fails a build listing
every empty artifact by locale and path.

`translation === ""` and `size === 0` are one rule in two representations. The report offers two
remedies, and the second is not a workaround: fill the file, **or** stop targeting the asset if it is
the same in every locale.

---

## §15 — Sink Targets ($S$ Detection)

§1 defines $S$ as _"a UI string assigned to a translatable property"_. This section is the formal rule
behind that sentence: which strings are $S$, and on what authority.

### §15.1 — The Evidence Axiom

> A **default** target MUST rest on evidence that the string is user-facing.
> A target resting on a name alone MUST be declared by the project.

A target is **structural** when the parser can see that the string occupies a rendering position, and
**nominal** when it matches an identifier and cannot know what that identifier holds.

| Class          | Targets                                                    | The evidence                           |
| :------------- | :--------------------------------------------------------- | :------------------------------------- |
| **Structural** | `html:attr:*`, `jsx:*:*`, HTML text, `tag:*`, DOM coinages | The string is in markup, or was tagged |
| **Qualified**  | `dom:<receiver>:*`, `obj:<binding>:*`, `call:<fn>:*`       | A named receiver, binding or callee    |
| **Nominal**    | `dom:prop:*`, `obj:*:<field>`                              | A property name; the holder is unknown |

Nominal targets are permitted but MUST NOT be defaults, because a name carries no information about
its holder: `{ label: "signup_click" }` is indistinguishable from a button caption. Extraction
**rewrites the value**, so a wrongly-matched string is returned translated at runtime — and under §5's
no-fallback rule it also fails the build until translated.

> [!NOTE]
> A property name may itself be evidence when it is not an ordinary word. `innerHTML`, `textContent`
> and `innerText` are DOM coinages that do not occur as arbitrary field names; `title`, `value`, `alt`
> and `label` do, and are therefore not defaults in unqualified form.

### §15.2 — Descriptor Grammar

```
descriptor  ::= jsx ":" element ":" attribute
              | "html:attr:" attribute
              | dom ":" receiver ":" property
              | obj ":" binding ":" field
              | "call:" callee ":" field
              | "tag:" identifier
element     ::= identifier | "*"
receiver    ::= identifier | "prop" | "*"
binding     ::= identifier | "field" | "*"
```

`*` denotes _any_, in **either** position: `obj:*:title` is any object's `title`; `obj:details:*` is
every field of an object named `details`. `prop` and `field` are the original spellings of `*` in the
receiver and binding positions and are equivalent to it.

An unrecognised descriptor, a wrong arity, an empty segment, or a path where a single name is expected
MUST be **rejected at construction**. A descriptor that matches nothing MUST NOT be accepted silently:
a stated intent that is discarded without a message is indistinguishable from a feature that does not
exist.

### §15.3 — Binding Resolution

For `obj:<binding>:<field>` and `call:<callee>:<field>`, the qualifying name is resolved by walking
**outward** from the property to the nearest name-carrying ancestor.

| Ancestor                                    | Contributes             |
| :------------------------------------------ | :---------------------- |
| `VariableDeclarator`, `FunctionDeclaration` | its `id`                |
| `PropertyDefinition` (class field)          | its `key`               |
| `CallExpression` with an identifier callee  | the callee, for `call:` |

Three rules govern the walk:

1. **The first binding is the answer**, whether or not it claims the field. Walking past it would let
   an outer scope's name capture an inner object.
2. **The walk crosses function bodies.** `const ui = () => ({ … })` and
   `function build() { return { … } }` are as common as the plain declaration, and stopping at the
   function would serve only the simplest form.
3. **The walk does not stop at the first object.** A field nested inside `const ui = { home: { … } }`
   resolves to `ui`, because that nesting is the ordinary shape of a strings object.

The name is the **local binding**, never an export alias. `const ui = …; export { ui as strings }` is
matched by `obj:ui:title` and not by `obj:strings:title`. There is not always one exported name —
`export { ui as a, ui as b }` is legal — while the local binding is always singular, and a target
describes where the object is written rather than how the module exposes it.

`obj:` and `call:` are distinct relations. _Bound to `cfg`_ and _passed to `cfg()`_ MUST NOT be
conflated, or `call:cfg:title` would match a `const cfg = { title }` unrelated to the call.

An object with no name-carrying ancestor — an anonymous `export default` — is **not addressable** by a
declared target. §15.5 covers it.

### §15.4 — Receiver Qualification

For `dom:<receiver>:<property>`, the receiver MUST be a plain identifier matching the descriptor.
`dom:document:title` matches `document.title` and not `telemetry.title`.

A member-expression receiver does not match: `window.document.title` is outside the rule. Following
member chains means walking arbitrary receivers, which reintroduces the guessing the qualification
exists to remove.

### §15.5 — Site Marking ($S$ by Declaration)

`@zintl-target` opts a node and its subtree in. Within a marked region every string field of an object
literal is $S$, regardless of its name.

It is the inverse of `@zintl-ignore` and composes with it: `@zintl-ignore` inside a marked region still
excludes that site. Regions nest, so the depth MUST be counted rather than flagged — an inner region
ending must not end the outer.

Marking is the only form that reaches a site with no resolvable name, and the only one that survives
renaming the binding.

### §15.6 — Target Composition

Targets reach the compiler from three sources and MUST **union**:

| Source              | Semantics                                        |
| :------------------ | :----------------------------------------------- |
| Facet `targets`     | **Replaces** that facet's own list               |
| `additionalTargets` | **Adds** to the resolved set                     |
| `@zintl-target`     | Adds at one site, for the duration of its region |

A facet declaring a subset of what an unconditional facet already declares narrows nothing — union is
the merge rule, so subtraction is expressible only by replacing a facet's list or excluding the facet.

---
