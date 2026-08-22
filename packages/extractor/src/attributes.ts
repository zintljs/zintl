/**
 * Translatable attributes in a run of markup — `alt`, `title`, `placeholder`
 * and friends.
 *
 * Its own module rather than a corner of `html.ts`, because both extraction
 * paths need it and `html.ts` cannot be one of `context.ts`'s imports: it
 * already imports `ExtractionContext` at runtime, and importing back would close
 * a cycle. Here the context is a *type* import, which erases.
 */
import type { ExtractionContext } from "./context.js";
import { generateMessageId } from "./hashing.js";

/** How an attribute sink is written back, which differs by where the markup lives. */
export interface AttributeScanOptions {
  /**
   * Is this markup embedded in a JavaScript template literal?
   *
   * It changes what gets replaced. In an HTML document or an SFC template the
   * whole attribute is rewritten — `alt="…"` becomes whatever the dialect's
   * `wrapHtmlAttribute` says. Inside a JS template there is a simpler answer
   * available: replace **only the value**, between the quotes that are already
   * there, and let the ordinary fragment path put a `${…}` in the hole. That
   * lands as `alt="${_t(…)}"`, which is valid plain JavaScript and a valid Lit
   * quoted attribute binding at the same time — so both hosts are served without
   * either one needing a new capability.
   */
  asFragment?: boolean;
  /** The literal the fragment sits inside, so a `"…"` host can be retyped as a template. */
  host?: { start: number; end: number; requiresQuoteConversion?: boolean };
}

/** Every attribute in `text` that carries a static, translatable value. */
const ATTRIBUTE_TAG = /<([a-zA-Z0-9:-]+)\s*([^>]*?)\/?>/g;
const ATTRIBUTE_PAIR = /\b([a-zA-Z0-9:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/gi;

/**
 * Register every translatable attribute in a run of markup.
 *
 * Lifted out of `extractHtml` so the JavaScript path can use it too. It had
 * lived only here, which is why an `alt` in an HTML document or an SFC template
 * reached a catalog while the identical `alt` inside `el.innerHTML = \`…\`` or a
 * Lit `` html`…` `` silently did not — the same markup, extracted by two code
 * paths, only one of which knew about attributes.
 *
 * `mapOffset` converts an index in `text` to a source offset. That is the whole
 * reason this can be shared: an HTML document adds a constant, and a template
 * literal walks its quasis, but both answer the same question. Template literals
 * also *refuse* — their mapper throws when a range crosses an interpolation —
 * which is what keeps `src=${logo}` from being mistaken for a string.
 */
export function scanTranslatableAttributes(
  text: string,
  ctx: ExtractionContext,
  fileBoundaryId: string,
  mapOffset: (index: number) => number,
  options: AttributeScanOptions = {},
): void {
  if (!ctx.htmlAttributes.size) return;
  const { asFragment = false, host } = options;

  ATTRIBUTE_TAG.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = ATTRIBUTE_TAG.exec(text)) !== null) {
    const attrsString = tagMatch[2];
    if (!attrsString) continue;

    const attrsIndex = tagMatch[0].indexOf(attrsString);
    ATTRIBUTE_PAIR.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = ATTRIBUTE_PAIR.exec(attrsString)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const quoted = attrMatch[2] !== undefined || attrMatch[3] !== undefined;
      const attrVal = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
      if (!attrVal || !ctx.htmlAttributes.has(attrName)) continue;

      const attrIndex = tagMatch.index + attrsIndex + attrMatch.index;
      let start: number;
      let end: number;

      if (asFragment) {
        /**
         * A value carrying an interpolation is skipped rather than mangled.
         * By the time markup reaches here from a template literal, `${expr}` has
         * already been normalized to `{name}`, so this one test covers both
         * `src=${logo}` (entirely an expression) and `title="Hello ${name}"`
         * (partly one). The second is translatable in principle and is a
         * separate piece of work — the HTML and SFC paths cannot do it either,
         * since both pass `variables: []`.
         */
        if (attrVal.includes("{")) continue;
        // The value sits at the end of the match, less its closing quote.
        const valueIndex = attrIndex + attrMatch[0].length - attrVal.length - (quoted ? 1 : 0);
        try {
          start = mapOffset(valueIndex);
          end = mapOffset(valueIndex + attrVal.length);
        } catch {
          // The mapper refused: the range crosses an interpolation.
          continue;
        }
      } else {
        start = mapOffset(attrIndex);
        end = start + attrMatch[0].length;
      }

      const msgId = generateMessageId(attrVal, "HTML_ATTR");
      ctx.addMessage(
        msgId,
        attrVal,
        "HTML_ATTR",
        fileBoundaryId,
        { line: 0, column: 0 },
        [],
        undefined,
        `html:attr:${attrName}`,
      );

      ctx.addRawSink({
        text: attrVal,
        sinkType: `html:attr:${attrName}`,
        start,
        end,
        line: 0,
        column: 0,
        boundaryId: fileBoundaryId,
        variables: [],
        isFragment: asFragment,
        ...(asFragment
          ? {
              fragmentStart: start,
              fragmentEnd: end,
              hostStart: host?.start,
              hostEnd: host?.end,
              requiresQuoteConversion: host?.requiresQuoteConversion ?? false,
            }
          : {}),
      });
    }
  }
}
