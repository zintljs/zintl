import type { CodegenFacet, ZintlFacet, TargetDescriptor } from "@zintljs/compiler";

export interface LitFacetOptions {
  /**
   * Replace the sinks scanned for translatable strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default `` tag:html `` plus the translatable object fields
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".ts", ".js"]
   */
  extensions?: string[];
}

/**
 * Extraction for Lit components.
 *
 * Lit has no file format of its own — a component is an ordinary module, and its
 * markup lives in `` html`…` `` tagged template literals inside a `render()`
 * method. That is why this facet declares a `` tag:html `` target rather than an
 * `sfcRules` entry: an SFC rule splits a file into regions by regex, which for a
 * `.ts` file would mean either hijacking every module in the project or leaving
 * the JavaScript around the template unextracted, taking `zintl()` anchors with
 * it.
 *
 * `tag:` says only "the contents of a template literal tagged with this
 * identifier are markup", which is a fact about syntax rather than about Lit.
 * Interpolations normalize to `{name}` placeholders and a sentence broken across
 * `<b>` stitches into one key, both by the same machinery that reads
 * `el.innerHTML = ` in a vanilla app.
 *
 * That shared machinery sets the coverage, including its edge: an attribute
 * *inside* the markup — `<button title="Close">` — is not extracted, because the
 * stitcher reads text and tags and leaves attributes alone. This is not a Lit
 * limitation; a vanilla `el.innerHTML = ` template behaves identically, and
 * `html:attr:` targets reach only real `.html` documents and SFC template
 * blocks. Lit therefore has exactly vanilla's coverage, which is the right
 * answer for a first implementation and the wrong one to paper over here — the
 * fix belongs in the stitcher, for both.
 *
 * Half of {@link litFacet}.
 */
export function litExtractionFacet(options: LitFacetOptions = {}): ZintlFacet {
  return {
    name: "lit-extraction",
    when: { framework: "lit" },
    concern: "extraction",
    priority: 100,
    targets: (options.targets || ["tag:html"]) as TargetDescriptor[],
    extensions: options.extensions || [".ts", ".js"],
  };
}

/**
 * Codegen for Lit components.
 *
 * Most of the work is already done by the time this is consulted: a stitched
 * fragment inside a template literal is replaced with `${_t(…)}` by default,
 * which is exactly right for Lit, because a Lit template *is* a template
 * literal. So this facet exists for the two cases the default cannot express.
 *
 * **Rich text.** A translation carrying markup has to be rendered as markup, and
 * Lit escapes interpolated strings by design. `unsafeHTML` is the directive that
 * opts out — an ordinary import, where React's `dangerouslySetInnerHTML` and
 * Svelte's `{@html}` are syntax and need nothing. That is what
 * {@link CodegenFacet.codegenImports} exists for.
 *
 * **Attributes.** Lit binds with `attr=${…}` rather than a quoted value.
 *
 * **A known limitation, stated rather than hidden.** This facet claims `.ts` and
 * `.js`, so in a Lit project it also sees a plain module doing
 * `el.innerHTML = "<p>…</p>"` — and would wrap that in `unsafeHTML`, which is
 * meaningless outside a Lit template. Lit apps do not usually mix the two, and
 * narrowing this properly needs `match` to see file *contents*, not just a path.
 * Worth fixing when someone hits it; not worth inventing a seam for first.
 *
 * Half of {@link litFacet}.
 */
export function litCodegenFacet(options: LitFacetOptions = {}): CodegenFacet {
  return {
    name: "lit-codegen",
    when: { framework: "lit" },
    concern: "codegen",
    priority: 100,
    extensions: options.extensions || [".ts", ".js"],
    match: (filePath: string) => filePath.endsWith(".ts") || filePath.endsWith(".js"),
    codegenImports: { "lit/directives/unsafe-html.js": ["unsafeHTML"] },
    wrapTemplateFragment: (call: string, hasTags: boolean): string =>
      // Plain text needs nothing — Lit renders an interpolated string as text,
      // which is exactly what it is. Markup needs the escape hatch, and only
      // where there is markup: `unsafeHTML` on every string would pay the
      // directive's cost for the majority of them that are just words.
      hasTags ? `\${unsafeHTML(${call})}` : `\${${call}}`,
  };
}

/**
 * Whether re-running a Lit entry is harmless. It is not.
 *
 * A Lit module's top level calls `customElements.define("my-el", MyEl)`, and the
 * registry throws `NotSupportedError` on a name that is already taken. So a
 * re-executed entry does not double-mount the way React does — it throws, and
 * the page is dead rather than merely wrong. Same declaration as Svelte and
 * Solid, for a louder reason.
 *
 * **`repaintsOnCatalogUpdate` is deliberately left undeclared**, which is the
 * honest form of "no". A Lit element redraws when a reactive property changes or
 * when something calls `requestUpdate()` on *that instance*, and a delivered
 * catalog can do neither: the store is a module-level singleton with no way to
 * reach live elements. Closing that needs a registry of connected components —
 * which is what `@lit/localize` maintains through a mixin — and a mixin is
 * application code, not something a compiler can inject. Until then the host
 * reloads the page on a catalog update, which is correct, just not free.
 */
export function litRuntimeFacet(): ZintlFacet {
  return {
    name: "lit-runtime",
    when: { framework: "lit" },
    concern: "runtime",
    priority: 100,
    entryReexecutionSafe: false,
  };
}

/**
 * Full Lit support: {@link litExtractionFacet}, {@link litCodegenFacet} and
 * {@link litRuntimeFacet}.
 *
 * Included in the built-in set when Lit is detected.
 */
export function litFacet(options: LitFacetOptions = {}): ZintlFacet[] {
  return [litExtractionFacet(options), litCodegenFacet(options), litRuntimeFacet()];
}
