import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { slugify } from "../src/lib/slug";
import type { SearchEntry } from "../src/lib/search";

/**
 * A search index per language, built from the same files the pages render.
 *
 * Built here rather than in the browser, because indexing at runtime would mean
 * downloading all eleven pages in order to search them — on a site whose whole
 * argument is that you receive the page you are reading and nothing else. The
 * index is headings and one sentence each: enough to find a page, far short of
 * shipping it.
 *
 * One module per locale, so a reader searching in Spanish downloads the Spanish
 * index and no other. `SiteSearch` imports it dynamically on the first keypress,
 * which keeps it off the critical path entirely.
 *
 * Reading the *artifacts* for the translated locales is what makes this work at
 * all: the translated body is the authored `.md` beside the catalogs, and it is
 * the only place that content exists.
 */

const VIRTUAL = "virtual:site-search/";
const RESOLVED = "\0" + VIRTUAL;

/** Mirrors `src/nav.ts`. A page is searchable once it is routable. */
const SECTIONS: Record<string, string[]> = {
  guide: [
    "what-is-zintl",
    "getting-started",
    "translating",
    "locales-and-switching",
    "plurals-and-grammar",
  ],
  concepts: ["boundaries-and-chunks", "glossary"],
  reference: ["configuration", "comment-directives", "integrations", "stability"],
};

function sectionOf(slug: string): string | undefined {
  return Object.keys(SECTIONS).find((id) => SECTIONS[id].includes(slug));
}

/**
 * Headings and the first sentence beneath each.
 *
 * Fenced code is skipped whole — a `#` inside a shell sample is a comment, not
 * a heading, and a sample's contents are not what anyone is searching for.
 */
function indexPage(source: string, section: string, slug: string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const lines = source.split("\n");

  let current: SearchEntry | undefined;
  let inFence = false;

  const push = () => {
    if (current) entries.push(current);
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      push();
      const text = heading[2].trim().replace(/`/g, "");
      current = {
        s: section,
        p: slug,
        t: text,
        h: heading[1].length === 1 ? "" : slugify(heading[2].trim()),
        x: "",
      };
      continue;
    }

    if (!current || current.x) continue;

    const trimmed = line.trim();
    // Skip tables, callouts, list markers and blank lines — a prose sentence is
    // what makes a useful excerpt.
    if (!trimmed || /^[|>\-*\d]/.test(trimmed)) continue;

    const plain = trimmed
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_]/g, "")
      .trim();
    if (plain) current.x = plain.length > 140 ? plain.slice(0, 139) + "…" : plain;
  }

  push();
  return entries;
}

export function searchIndex(options: { sourceLocale: string; locales: string[] }): Plugin {
  const { sourceLocale, locales } = options;
  let root = "";

  return {
    name: "site-search-index",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      return id.startsWith(VIRTUAL) ? "\0" + id : undefined;
    },

    load(id) {
      if (!id.startsWith(RESOLVED)) return undefined;

      const locale = id.slice(RESOLVED.length);
      if (!locales.includes(locale)) return "export default [];";

      const dir =
        locale === sourceLocale ? join(root, "src/content") : join(root, "zintl/src/content");
      const suffix = locale === sourceLocale ? ".md" : `.${locale}.md`;

      const entries: SearchEntry[] = [];
      let files: string[] = [];
      try {
        files = readdirSync(dir);
      } catch {
        // No artifacts yet — an empty index beats a failed build.
        return "export default [];";
      }

      for (const file of files.sort()) {
        if (!file.endsWith(suffix)) continue;
        const slug = file.slice(0, -suffix.length);
        const section = sectionOf(slug);
        if (!section) continue;

        const source = readFileSync(join(dir, file), "utf8");
        if (!source.trim()) continue;
        entries.push(...indexPage(source, section, slug));
      }

      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
