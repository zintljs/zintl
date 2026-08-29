/**
 * The docs tree — the sidebar, the header, the pager and the route table all
 * read from here, so a page exists in exactly one place.
 *
 * **A function, not a constant, and that is a load-bearing detail.**
 *
 * Extraction rewrites each `title` into a `_t(…)` call that reads the active
 * catalog *when it runs*. At module scope it would run exactly once, during
 * import — and imports are hoisted, so that happens before `main.ts` has
 * finished awaiting `zintl()`. The tree would freeze in the source locale on
 * first paint and never move again, which is precisely how it behaved before
 * this comment existed: an Arabic page with an English navigation bar.
 *
 * Calling it per render puts the lookup back inside the locale's lifetime.
 * Callers make it reactive by touching the route's locale in the same
 * `computed`, which is honest — the route *is* where the locale lives here.
 *
 * Section and page titles reach extraction through
 * `additionalTargets: ["obj:nav:title"]` in `vite.config.ts`. An object field is
 * not a default target — `{ label: "signup_click" }` is as often an analytics
 * event as a button — so the object is *named* instead, which leaves the `slug`
 * and `id` beside each title untouched.
 */
function nav() {
  return {
    sections: [
      {
        id: "guide",
        title: "Guide",
        pages: [
          { slug: "what-is-zintl", title: "What is Zintl" },
          { slug: "getting-started", title: "Getting started" },
          { slug: "translating", title: "Translating" },
          { slug: "locales-and-switching", title: "Locales and switching" },
          { slug: "plurals-and-grammar", title: "Plurals and grammar" },
        ],
      },
      {
        id: "concepts",
        title: "Concepts",
        pages: [
          { slug: "boundaries-and-chunks", title: "Boundaries and chunks" },
          { slug: "glossary", title: "Glossary" },
        ],
      },
      {
        id: "reference",
        title: "Reference",
        pages: [
          { slug: "configuration", title: "Configuration" },
          { slug: "comment-directives", title: "Comment directives" },
          { slug: "integrations", title: "Integrations" },
          { slug: "stability", title: "Stability" },
        ],
      },
    ],
  };
}

export interface DocPage {
  slug: string;
  title: string;
}

export interface DocSection {
  id: string;
  title: string;
  pages: DocPage[];
}

export function getSections(): DocSection[] {
  return nav().sections;
}

/** Every page in reading order, which is what prev/next means. */
function flatPages(): { section: DocSection; page: DocPage }[] {
  return getSections().flatMap((section) => section.pages.map((page) => ({ section, page })));
}

export function findPage(sectionId: string, slug: string) {
  return flatPages().find(({ section, page }) => section.id === sectionId && page.slug === slug);
}

/** The pages either side of this one, in reading order across section borders. */
export function neighbours(sectionId: string, slug: string) {
  const pages = flatPages();
  const index = pages.findIndex(
    ({ section, page }) => section.id === sectionId && page.slug === slug,
  );
  return {
    previous: index > 0 ? pages[index - 1] : undefined,
    next: index >= 0 && index < pages.length - 1 ? pages[index + 1] : undefined,
  };
}
