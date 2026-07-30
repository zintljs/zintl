/**
 * @module zintl
 *
 * The root entry is the macro surface — `zintl()`, `t()`, and the locale
 * helpers you call from application code. It is exactly `zintl/macro`, kept as
 * an alias so `import { zintl } from "zintl"` works.
 *
 * The Vite plugin is **not** here. It lives at `zintl/vite` and is a default
 * export:
 *
 * ```ts
 * import zintl from "zintl/vite";        // vite.config.ts — the plugin
 * import { zintl } from "zintl";         // your app — the macro
 * ```
 *
 * Facet presets and the facet-authoring types live at `zintl/facets`.
 */
export * from "./macro.js";
