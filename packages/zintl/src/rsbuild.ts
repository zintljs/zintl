/**
 * @module zintl/rsbuild
 *
 * The Zintl Rsbuild plugin — the same plugin as `zintljs/vite` behind a
 * different entry point, not a second implementation.
 *
 * Supported in production builds and in `rsbuild dev`, with **React, Vue,
 * Svelte and vanilla JavaScript**, for single-page apps and for ordinary
 * multi-page apps (several `source.entry` keys, several HTML templates).
 * Chunk-aligned catalogs — including lazily-imported routes — ghost mode,
 * localized assets, per-locale `<html lang>`/`dir` and hot updates all carry
 * over, with no Rspack-specific code in the compiler. Requires `@rsbuild/core` —
 * an optional peer dependency, tested against `^2.1.0`. Every configuration
 * named here is driven by the contract suite; see `examples/rsbuild-*`.
 *
 * **Vue's Options API works**, here and on Vite alike. A plain `<script>`
 * compiles its template into a separate render function that cannot see the
 * script block's scope, so Zintl authors a `<script setup>` block beside yours
 * to carry its imports and Vue compiles the two together. Refused with a build
 * error, rather than an empty page: `<script src>`, a non-JS/TS `lang`, and a
 * component that already declares `setup`. See L-053.
 *
 * **How a dev edit reaches the screen depends on the app, not on this host.**
 * Where components re-read the catalog, the edit applies in place — today that
 * is React. Where nothing does, the entry declines the update and the page
 * reloads: on Rspack a re-executed entry reads its imports from the module
 * cache, so an app whose only repaint is re-running its entry would otherwise
 * re-seed from a stale catalog and render empty strings. Reloading is slower and
 * correct.
 *
 * One consequence of the reload, measured rather than predicted: an edit to a
 * string in a boundary the manager has to *fetch* (a component, a lazy route)
 * can lose the race with the catalog write, so the reloaded page paints empty
 * before it paints the new text. An edit to a string in the entry's own boundary
 * does not, because the manager inlines that catalog for the active locale. It
 * is why `examples/rsbuild-vanilla-basic` claims the `hmr` capability and
 * `examples/rsbuild-svelte-basic` does not.
 *
 * Not supported, deliberately rather than pending:
 *
 * - **`multiplex`** — per-locale HTML fan-out is Vite-only and not planned
 *   here. Combining it with this host fails the build immediately with a clear
 *   error rather than doing nothing quietly.
 * - **SSR** — unbuilt and unexamined. There is no Rsbuild SSR path to route to.
 *
 * One difference worth knowing about rather than discovering: the HTML
 * projection injects no `<link rel="modulepreload">` here, so catalogs begin
 * loading one network round-trip later than they would on Vite.
 *
 * How each of these was established is written up in
 * `docs/spec/proposals/026`–`030` and their leak ledgers.
 */
import unplugin from "./plugin.js";

/**
 * The Zintl Rsbuild plugin.
 *
 * Returns an array of Rsbuild plugins; spread it into `plugins`.
 *
 * @example
 * ```ts
 * // rsbuild.config.ts
 * import { defineConfig } from "@rsbuild/core";
 * import zintl from "zintljs/rsbuild";
 *
 * export default defineConfig({
 *   plugins: [
 *     ...zintl({
 *       sourceLocale: "en",
 *       locales: ["en", "ar"],
 *       outputDir: "./src/locales",
 *     }),
 *   ],
 * });
 * ```
 */
const rsbuild = unplugin.rsbuild;
export default rsbuild;
export { rsbuild as "module.exports" };

export type { Options, Options as ZintlOptions, FacetsInput } from "./types.js";
