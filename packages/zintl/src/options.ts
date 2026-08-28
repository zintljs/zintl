/**
 * The one place a Zintl default is written down.
 *
 * Before this, defaults were applied lazily at ~30 read sites across two
 * packages — `locales || ["en"]` appeared eight times, `sourceLocale || "en"`
 * four, `logLevel` was defaulted in three stacked layers, and `verifyIntegrity`
 * had three rules that disagreed. Finding where a value came from meant grepping.
 *
 * Now the plugin resolves options once, at creation, and everything downstream
 * reads concrete values off `ctx.options`.
 *
 * Two defaults are deliberately *not* resolved here, because they cannot be
 * known until Vite tells us. Both are documented in {@link DEFAULTS} and each is
 * applied at exactly one site:
 *
 * - `multiplex` — `undefined` means "auto-detect by scanning entry files"
 *   (`Context.getMultiplex`).
 * - `verifyIntegrity` — `undefined` means "on for `build`, off for `serve`"
 *   (`configResolvedHook`).
 */
import type { LogLevel } from "@zintljs/compiler";
import type { FacetsInput, Options } from "./types.js";

/**
 * Every context-free default, in one table.
 *
 * `outputDir`, `catalogFormat`, `metadataDir` and `similarityThreshold` are
 * intentionally absent: the compiler owns those defaults (`DEFAULT_OUTPUT_DIR`,
 * the catalog format fallback, `node_modules/.zintl`, `DEFAULT_RENAME_THRESHOLD`)
 * and re-stating them here would recreate the duplication this file exists to
 * remove. Leaving them `undefined` lets the compiler apply its own.
 */
export const DEFAULTS = {
  sourceLocale: "en",
  locales: ["en"] as string[],
  pendingLocales: [] as string[],
  prune: true,
  debug: false as boolean | string,
  virtualAssets: false,
  facets: ["builtins"] as FacetsInput[],
  /** `undefined` → auto-detect by scanning entry files for `zintl()` / `zintl("*")`. */
  multiplex: undefined as boolean | undefined,
  /** `undefined` → `true` for `vite build`, `false` for `vite serve`. */
  verifyIntegrity: undefined as boolean | undefined,
  /** `undefined` → fall back to Vite's own `logLevel`, then `"info"`. */
  logLevel: undefined as LogLevel | undefined,
} as const;

/**
 * Plugin options with every context-free default applied.
 *
 * The fields that stay optional are the ones nobody can resolve without Vite
 * (see the module docblock) or that the compiler defaults itself.
 */
export interface ResolvedOptions extends Options {
  sourceLocale: string;
  locales: string[];
  pendingLocales: string[];
  prune: boolean;
  debug: boolean | string;
  virtualAssets: boolean;
  facets: FacetsInput[];
}

export function resolveOptions(options?: Options): ResolvedOptions {
  const o = options ?? {};

  return {
    ...o,
    sourceLocale: o.sourceLocale ?? DEFAULTS.sourceLocale,
    // Array defaults are copied: `DEFAULTS` holds one instance, and handing the
    // same array to every caller would let one plugin instance mutate another's
    // locale list.
    locales: o.locales ?? [...DEFAULTS.locales],
    pendingLocales: o.pendingLocales ?? [...DEFAULTS.pendingLocales],
    prune: o.prune ?? DEFAULTS.prune,
    debug: o.debug ?? DEFAULTS.debug,
    virtualAssets: o.virtualAssets ?? DEFAULTS.virtualAssets,
    facets: o.facets ?? [...DEFAULTS.facets],
  };
}
