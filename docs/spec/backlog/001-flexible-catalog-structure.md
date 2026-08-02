# Feature Backlog: Flexible Catalog Structure

**View:** Feature requested to give users control over the output directory structure for their dev translation catalogs.
**Problem:** The original implementation hard-coded the `[boundaryId].[locale].json` physical file routing. In large projects (Next.js, SvelteKit), boundary names are often `+page.server.ts` or `src/components/App:myFunction`. Dumping all of these in a flat directory results in messy layouts that translators hate. However, the system fundamentally needs boundaries to maintain a deterministic chunking boundary graph for fast load times. Giving users the power to mutate the graph via custom namespaces could accidentally break the entire system runtime.
**Affected System Parts:** `packages/compiler/src/types.ts` (`ZintlOptions`), `packages/compiler/src/index.ts` (`getCatalogPath`, constructor).
**Solution:**
We introduced a `catalogFormat` tokenized routing engine that completely abstracts the physical file layout away from the internal logic.

1. Developers define things like `catalogFormat: "[locale]/[dir]/[name].json"`.
2. The compiler intercepts tokens and safely routes output there using path templating.
3. Added fallback cleansers (like replacing dangling `-.json` if `[func]` is empty, or stripping double slashes).
4. Ensured that `bId` and boundary graph generation are physically decoupled from the `.json` structure, meaning the chunk mechanism functions as a black box and ignores file locations.

   **Notes:**

- Support arrays/functions for deeper custom logic.
- We deliberately disabled allowing the user to map properties _inside_ generated JSON, constraining them entirely to physical layout design.
- Supported tokens: `[locale]`, `[bId]`, `[hash]`, `[path]`, `[dir]`, `[name]`, `[func]`.
