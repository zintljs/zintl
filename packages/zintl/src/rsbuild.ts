/**
 * @module zintl/rsbuild
 *
 * The Zintl Rsbuild plugin — the same plugin as `zintljs/vite` behind a
 * different entry point, not a second implementation.
 *
 * Supported for single-page applications, in production builds and in
 * `rsbuild dev`. Chunk-aligned catalogs, ghost mode, localized assets and
 * per-locale `<html lang>`/`dir` all carry over, with no Rspack-specific code
 * in the compiler. Requires `@rsbuild/core` — an optional peer dependency,
 * tested against `^2.1.0`.
 *
 * **How a dev edit reaches the screen depends on the app, not on this host.**
 * Where components re-read the catalog, the edit applies in place. Where
 * nothing does, the entry declines the update and the page reloads: on Rspack a
 * re-executed entry reads its imports from the module cache, so an app whose
 * only repaint is re-running its entry would otherwise re-seed from a stale
 * catalog and render empty strings. Reloading is slower and correct.
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
