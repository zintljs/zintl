/**
 * @module zintl/vite
 *
 * The Vite plugin, and the public types for configuring it.
 */
import unplugin from "./plugin.js";

/**
 * The Zintl Vite plugin.
 *
 * Add it once, and Zintl takes over internationalization from there: it
 * extracts the strings reachable from every `zintl()` anchor, writes a catalog
 * per locale into {@link Options.outputDir | `outputDir`}, splits those catalogs
 * along your bundler's own code-splitting boundaries, and rewrites the macros
 * into a runtime with no message parser shipped to the client.
 *
 * Returns two Vite plugins — a `pre` pass that localizes HTML entries before
 * anything else touches them, and the main `zintl` plugin. Pass the array
 * straight to `plugins`; Vite flattens it.
 *
 * Catalogs are written for you but owned by you: edit them, commit them, hand
 * them to translators. Renamed and lightly edited source strings carry their
 * translations forward instead of resetting (see
 * {@link Options.similarityThreshold | `similarityThreshold`}).
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import zintl from "zintljs/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     zintl({
 *       sourceLocale: "en",
 *       locales: ["en", "ar", "fr"],
 *       outputDir: "./src/locales",
 *     }),
 *   ],
 * });
 * ```
 *
 * @see {@link Options} for every option and its default.
 */
const vite = unplugin.vite;
export default vite;
export { vite as "module.exports" };

export type { Options, Options as ZintlOptions, FacetsInput } from "./types.js";
export type { AssetTargetConfig, CatalogFormatContext, LogLevel } from "@zintljs/compiler";
