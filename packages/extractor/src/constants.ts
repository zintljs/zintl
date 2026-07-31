/**
 * The extractor's only constants.
 *
 * The former `DEFAULT_UI_ATTRIBUTES` / `DEFAULT_UI_OBJECT_FIELDS` /
 * `DEFAULT_UI_SINK_PROPERTIES` sets and `TEMPLATE_ATTR_REGEX` lived here and
 * encoded opinions about which DOM and JSX attributes are translatable. That is
 * facet knowledge — it now lives in `@zintljs/compiler/facets` and reaches the
 * extractor as descriptors. All four were already unreferenced (one survived
 * only inside a commented-out line) and have been removed.
 */
/**
 * The macro's *identifier* — the `zintl(...)` call users write. This is the
 * public API surface and is intentionally NOT the package name: the npm package
 * is `zintljs` (the bare `zintl` name is blocked by npm's similarity filter),
 * but the function it exports is still `zintl`.
 */
export const ZINTL_MACRO = "zintl";

/** The npm package specifier that carries the runtime. */
export const RUNTIME_PACKAGE = "zintljs";

/**
 * Module specifiers that carry the Zintl runtime surface.
 *
 * This list was previously inlined at four call sites (`parser.ts`, two in
 * `visitors/program.ts`, one in `visitors/bindings.ts`) and the four had drifted:
 * the `bindings.ts` copy omitted the bare `"zintl"` literal, so a project with a
 * custom `runtimePackage` would have had its bare `"zintl"` imports recognised
 * by three of the four checks and missed by the fourth.
 */
export const RUNTIME_SPECIFIERS: readonly string[] = [
  "zintljs",
  "zintljs/internal",
  "zintljs/macro",
  // Virtual module IDs are internal and keep the `zintl` brand prefix.
  "virtual:zintl/runtime/internal",
];

/** Whether an import specifier resolves to the Zintl runtime. */
export function isRuntimeSpecifier(source: string, runtimePackage = RUNTIME_PACKAGE): boolean {
  return source === runtimePackage || RUNTIME_SPECIFIERS.includes(source);
}

export const HTML_TAG_SPLIT_REGEX = /(<[^>]+>)/g;
