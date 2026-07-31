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
export const ZINTL_MACRO = "zintl";
export const RUNTIME_PACKAGE = "zintl";

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
  "zintl",
  "zintl/internal",
  "zintl/macro",
  "virtual:zintl/runtime/internal",
];

/** Whether an import specifier resolves to the Zintl runtime. */
export function isRuntimeSpecifier(source: string, runtimePackage = RUNTIME_PACKAGE): boolean {
  return source === runtimePackage || RUNTIME_SPECIFIERS.includes(source);
}

export const HTML_TAG_SPLIT_REGEX = /(<[^>]+>)/g;
