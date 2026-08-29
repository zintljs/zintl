declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

/**
 * The per-locale search indexes, produced by `build/search-index.ts`.
 *
 * Declared rather than inferred: the module does not exist on disk, so nothing
 * can look at it to work out what it exports.
 */
declare module "virtual:site-search/*" {
  import type { SearchEntry } from "./lib/search";
  const entries: SearchEntry[];
  export default entries;
}
