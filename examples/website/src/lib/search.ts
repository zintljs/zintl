/**
 * One searchable heading.
 *
 * Declared under `src/` rather than beside the plugin that produces it, because
 * the plugin is compiled by `tsconfig.node.json` and the component by
 * `tsconfig.app.json` — the build side may reach into the app's sources, and the
 * app side may not reach back. Short field names because this ships: the index
 * is a few hundred of these.
 */
export interface SearchEntry {
  /** Section id — `guide`, `concepts`, `reference`. */
  s: string;
  /** Page slug. */
  p: string;
  /** Heading text, or the page title for the page's own entry. */
  t: string;
  /** Anchor, empty for the page itself. */
  h: string;
  /** First sentence under that heading. */
  x: string;
}
