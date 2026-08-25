import type { ZintlFacet, TargetDescriptor } from "@zintljs/compiler";

export interface VanillaFacetOptions {
  /**
   * Replace the sinks that are scanned for translatable strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default the DOM text sinks (`innerHTML`, `textContent`, `innerText`) plus
   * the `label`, `title`, `description`, `text`, `tooltip` and `placeholder`
   * object fields
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".ts", ".js", ".mts", ".mjs"]
   */
  extensions?: string[];
}

/**
 * Extraction for plain JavaScript and TypeScript.
 *
 * Picks up strings assigned to the DOM text properties — `innerHTML`,
 * `textContent`, `innerText` — and a set of plain-object fields. This is what
 * makes a framework-less app translatable with no annotation at all.
 *
 * The object fields are on notice: they match a name with no knowledge of what
 * the object is, so `{ label: "signup_button_click" }` is extracted and
 * translated like any label. Proposal 033 tracks replacing them with declared
 * targets; they are still here because two examples depend on them and the
 * migration comes first.
 *
 * Included in the built-in set, for every project, alongside whichever framework was
 * detected.
 */
export function vanillaFacet(options: VanillaFacetOptions = {}): ZintlFacet {
  return {
    name: "vanilla-extraction",
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
      /**
       * DOM coinages only — `innerHTML`, `textContent`, `innerText`.
       *
       * `dom:prop:` matches a property *name* and never learns anything about
       * the receiver: no type information is available on an oxc parse, and
       * dataflow tracing was deliberately removed (backlog 005). So
       * `featureFlag.value = "x"` and `telemetry.title = "x"` were extracted
       * and translated, which for a default target breaks the rule that it must
       * never catch text that is not user-facing.
       *
       * The three that remain are not English words. Nobody names an ordinary
       * field `innerHTML`, so the name is itself the evidence — which is what
       * `title`, `alt`, `value`, `placeholder` and the `aria-*` pair could never
       * offer. Those were dropped; see proposal 033 §9.1. Measured first: no
       * example in the repository loses a single string.
       *
       * Add them back for a project that wants them — `vanillaFacet({ targets:
       * [...] })` replaces this list, and then the false positives are yours.
       */
      "dom:prop:innerHTML",
      "dom:prop:textContent",
      "dom:prop:innerText",
      /**
       * Receiver-qualified, and that is the whole point.
       *
       * `document.title` is the browser tab — as user-facing as text gets — so
       * it has to be a default. A bare `dom:prop:title` made it one by matching
       * the *property name*, which meant `telemetry.title = "signup_click"` was
       * extracted and translated too.
       *
       * The receiver is the difference. `document` is a literal identifier in
       * the source, so this is structural evidence of the same kind
       * `jsx:<element>:<attribute>` rests on — not a guess about a noun. Its
       * five former neighbours (`alt`, `placeholder`, `value`, `aria-label`,
       * `aria-description`) have variable receivers and no such evidence, which
       * is why they were dropped outright rather than qualified.
       */
      "dom:document:title",
      "obj:field:label",
      "obj:field:title",
      "obj:field:description",
      "obj:field:text",
      "obj:field:tooltip",
      "obj:field:placeholder",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".ts", ".js", ".mts", ".mjs"],
  };
}
