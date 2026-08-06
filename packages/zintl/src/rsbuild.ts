/**
 * @module zintl/rsbuild
 *
 * The Zintl Rsbuild plugin.
 *
 * **Experimental, and deliberately narrow.** This entry point exists to give
 * proposal 026 a real second host to test against — a build tool whose plugin
 * model is not Rollup's, so that the claim "the compiler is bundler-agnostic"
 * has something that can disprove it. It is not a supported target, and the
 * `zintljs` package does not yet promise it will behave.
 *
 * What is known to work is ZDB §7a **Tier 1**: virtual modules, `transform`
 * with stable ids, `buildStart`/`buildEnd`, and `enforce: "pre"` ordering.
 * Tier 2 — hot updates — is not attempted here, and should not be until the
 * two load-bearing requirements in §7a (a monotonic per-event sequence, and a
 * `read()` scoped to that event) are shown to exist on this host.
 *
 * Notable gaps against the Vite entry point, all reproduced rather than
 * assumed — see `docs/spec/proposals/026-leak-ledger.md`:
 *
 * - `this.resolve` does not exist in unplugin's Rspack build context, so
 *   anything that walked the graph through the host resolver cannot run here.
 * - `emitFile` returns nothing, so asset localisation has no reference id to
 *   interpolate.
 * - The HTML fan-out, SSR and multiplex paths are untested on this host.
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
