import {
  clickLocaleBar,
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

/**
 * Lit on Vite.
 *
 * The project that exercises the extractor's `tag:` descriptor end to end —
 * markup inside a tagged template literal, stitched into keys with its tag map.
 * `headingFile` is **`index.html`**, which is the surprising part and worth
 * knowing before reading a failure here. The lit-ts template renders
 * `<slot></slot>` and puts `<h1>Get started</h1>` in the document, inside
 * `<my-element>`. So the heading is light-DOM content projected through a slot —
 * extracted by the HTML facet, not from the component's `html` template — and
 * `document.querySelector("h1")` still finds it, because slotted content stays
 * in the light tree.
 *
 * The capability list is deliberately shorter than `react-basic`'s. Every
 * capability here has been run; the ones that are absent — `chaos`,
 * `performance`, `memory`, the stress variants — are absent because they have
 * not been, and `tests/manifests/index.ts` is explicit that an inert claim
 * "costs nothing at runtime but misreports what is covered". They are cheap to
 * add once measured.
 */
export const litBasic: ProjectManifest = {
  name: "lit-basic",
  source: copiedExampleSource("lit-basic"),
  zintlOptions,
  /**
   * No `hmr` claim, and that is a measured limitation rather than an oversight.
   *
   * `catalog-edit` and `hmr-first-tick` both require it, and both are asking for
   * something Lit cannot do today: repaint a live element when a catalog is
   * delivered. A Lit element redraws on a reactive property change or an
   * explicit `requestUpdate()` on *that instance*, and a module-level store can
   * reach neither without a registry of connected components — the thing
   * `@lit/localize` maintains through a mixin, which is application code rather
   * than something a compiler injects. `litRuntimeFacet` leaves
   * `repaintsOnCatalogUpdate` undeclared for the same reason, so the host
   * reloads, and `catalog-edit` fails a reload on purpose (ZHMR §4.1).
   *
   * Claiming it anyway would turn a known gap into two red contracts that say
   * nothing new. Switching locale from the bar works and is covered — that path
   * goes through the app's own state, not through catalog delivery.
   */
  capabilities: ["spa", "locale-switch", "rtl", "boundary-graph", "transform", "build", "graph"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "index.html",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
