---
"@zintljs/extractor": patch
---

Refactor extractor fast-path and boundary assignment to be fully driven by configuration and structure, removing all sink-based speculation.

**Fast-path & Target-Driven Optimizations**:

- **`types.ts`**: Added `"nextjs"` as a supported `TargetDescriptor`.
- **`targets.ts`**: Introduced the `"nextjs"` target preset (which inherits standard JSX/object field rules). Completely eliminated framework-specific target flags (`isReactTarget`, `isVueTarget`, `isSvelteTarget`, `isNextjsTarget`) from `ResolvedTargets`.
- **`context.ts`**: Removed the target boolean flags from `ExtractionContext`, resolving rule sets (like `mustacheRegex`) dynamically using configuration target presets and extension-based fallbacks.
- **`parser.ts`**: Replaced the hardcoded `isLikelyUI` check with `resolved.fastPathRegex.test(code)`.
- **`visitors/index.ts`**: Conditionally mount the JsxVisitor only when JSX targets are active.
- **`visitors/bindings.ts`**: Conditionally register AST hooks for `AssignmentExpression` (only if DOM targets are active) and `Property` (only if object fields are configured), bypassing expensive node checks.
- **`visitors/program.ts`**: Decoupled Next.js metadata/viewport export suppression logic from standard React projects, gating it dynamically via the target suppression metadata rules.
- **`html.ts`**: Optimized mustache template parsing by using target flags, and refined SFC template checks using path extensions combined with targets to prevent stripping the `htmlProjection` metadata on top-level static HTML entry pages (like `index.html`).
- **`hooks/config.ts`**: Added auto-detection for the `"nextjs"` framework when `"next"` or `"vinext"` is detected in package dependencies or plugin lists.

**Declarative Extractor Languages (Knowledge Zeroing)**:

- **SFC Segmentation Language**: Added `SfcRule` and `SfcBlockRule` interfaces. Extractor now splits Vue, Svelte, and Astro SFC files using fully custom, declarative regex-based block segmentation rules instead of hardcoded splitters.
- **AST Suppression Language**: Added `SuppressionRule` interface. Extractor AST walker checks nodes generically against configurable suppression criteria (matching types, names, and root-level scopes) to bypass zero-config extraction on server-only subtrees.
- **Generic Parsers**: HTML extraction and AST visitors are decoupled from framework file extension checks, dynamically utilizing the resolved rules (such as `mustacheRegex` and `activeRange`/`isSfcTemplate` for HTML template stitching).

**Boundary assignment (structural)**:

- **Removed `hasSinksOrCalls`**: The recursive subtree walk that speculatively assigned sub-boundaries to any function with UI sinks is gone. It was a second tree traversal inside the first walk and relied on framework-specific hardcoded checks (`["innerHTML", "innerText"]`, unconditional JSX node checks).
- **Replaced with structural rule**: Every top-level **exported** function gets its own sub-boundary deterministically — no sink scan required. The compiler's binding tracker uses these to attribute strings precisely when a consumer imports only a subset of a file's exports. In zero-config mode, all top-level functions (including non-exported) get sub-boundaries, mirroring the existing fast-path behavior.
- **Local functions** (non-exported, no explicit `zintl()` anchor) now correctly collapse to the file's root boundary. The compiler's boundary graph handles reachability at the file level.

**Effect**: The extractor now has two sources of truth for boundaries — explicit `zintl()` anchors and structural exports — with no guessing about sink content. Framework knowledge lives entirely in `ExtractionOptions.targets`.
