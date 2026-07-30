---
"@zintl/extractor": minor
"@zintl/compiler": minor
---

Made `@zintl/extractor` genuinely framework-blind. A previous changeset claimed the extractor had been "fully decoupled" from framework presets; that was inaccurate — the tables were left in place, duplicating the facet presets, and one of them was still on a live code path.

**Deleted from `targets.ts`:**

- `TARGET_PRESETS` — full descriptor lists for `vanilla`, `react`, `nextjs`, `vue`, `svelte` and `html`.
- `TARGET_METADATA` and the `TargetMetadata` type — Vue and Svelte SFC block rules, Svelte's mustache pattern, and the Next.js `generateMetadata` / `generateViewport` suppression rules.
- `DEFAULT_SFC_RULES` and `DEFAULT_SUPPRESSION_RULES`.

Every one of these duplicated a facet preset in `@zintl/compiler/facets`, which is now the single source of truth. The Vue and Svelte block rules were byte-identical to their preset counterparts.

**Removed the one live leak.** `parser.ts` fell back to `DEFAULT_SFC_RULES` whenever the caller's rules did not cover a file's extension, so any `.vue` or `.svelte` file received Vue/Svelte block-splitting from the extractor itself even when no rules were supplied. SFC rules are now caller-supplied only.

**`TargetDescriptor` no longer names a framework.** The `"auto" | "react" | "nextjs" | "vue" | "svelte" | "html" | "vanilla"` members are gone, leaving only the structural forms (`jsx:*:attr`, `jsx:El:attr`, `dom:prop:x`, `dom:attr:x`, `obj:field:x`, `html:attr:x`) and `TargetPlugin`. `resolveTargets` is correspondingly reduced to pure structural compilation — descriptors into lookup sets, plugin collection and a fast-path regex — with no preset expansion and no rule derivation.

**No default target set.** `parser.ts` and `context.ts` both defaulted to `["vanilla", "react", "html"]`. A framework-blind executor has nothing sensible to guess, so callers now declare their sinks; production supplies a fully compiled state from the resolved facets.

**Removed dead sink opinions.** `DEFAULT_UI_ATTRIBUTES`, `DEFAULT_UI_OBJECT_FIELDS`, `DEFAULT_UI_SINK_PROPERTIES` and `TEMPLATE_ATTR_REGEX` encoded which DOM and JSX attributes are translatable. All four were already unreferenced — one survived only inside a commented-out line.

**Fixed drifted runtime-specifier detection.** The check for Zintl's own module specifiers was inlined at four sites (`parser.ts`, two in `visitors/program.ts`, one in `visitors/bindings.ts`) and the copies had diverged: the `bindings.ts` variant omitted the bare `"zintl"` literal, so a project configuring a custom `runtimePackage` would have had bare `"zintl"` imports recognised by three checks and missed by the fourth. All four now call the new `isRuntimeSpecifier` helper, backed by a single `RUNTIME_SPECIFIERS` list.

**Verification.** The contract snapshots passed with zero diffs, which is the proof that the deleted tables were dead in production. Three new architecture tests assert that the extractor names no framework anywhere in its source, exposes no preset tables, and that `resolveTargets([])` yields a genuinely empty world.
