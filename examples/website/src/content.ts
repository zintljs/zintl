/**
 * The docs bodies.
 *
 * Each page is a `.md` file, which `assetsTarget`'s default (`["md", "txt"]`)
 * already treats as a **localized asset**: Zintl writes an empty artifact per
 * locale for us to author, and never copies the English across, because an
 * English paragraph at the Arabic path is not an Arabic paragraph.
 *
 * `?raw` asks for the contents rather than a URL, so the body is inlined into
 * this page's catalog and follows the locale at runtime. The import is dynamic
 * so each page is its own chunk — which is the demonstration rather than an
 * optimization: navigate, and the only markdown that arrives is the page you
 * opened, in the language you are reading it in.
 */
const loaders: Record<string, () => Promise<{ default: string }>> = {
  "guide/what-is-zintl": () => import("./content/what-is-zintl.md?raw"),
  "guide/getting-started": () => import("./content/getting-started.md?raw"),
  "guide/translating": () => import("./content/translating.md?raw"),
  "guide/locales-and-switching": () => import("./content/locales-and-switching.md?raw"),
  "guide/plurals-and-grammar": () => import("./content/plurals-and-grammar.md?raw"),
  "concepts/boundaries-and-chunks": () => import("./content/boundaries-and-chunks.md?raw"),
  "concepts/glossary": () => import("./content/glossary.md?raw"),
  "reference/configuration": () => import("./content/configuration.md?raw"),
  "reference/comment-directives": () => import("./content/comment-directives.md?raw"),
  "reference/integrations": () => import("./content/integrations.md?raw"),
  "reference/stability": () => import("./content/stability.md?raw"),
};

export async function loadPage(sectionId: string, slug: string): Promise<string | undefined> {
  const loader = loaders[`${sectionId}/${slug}`];
  if (!loader) return undefined;
  return (await loader()).default;
}
