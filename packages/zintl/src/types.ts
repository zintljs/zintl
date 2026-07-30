/**
 * The plugin's public option surface.
 *
 * Every option a user can set is declared here, in full, with its effective
 * default — deliberately *not* inherited from `CompilerOptions`. Inheriting made
 * ctrl+click land in compiler internals, on an interface whose only documented
 * field (`capabilities`) is the one field a user can never set.
 *
 * The link to the compiler is kept as a compile-time assertion instead (see
 * {@link _OptionsCoversCompiler}), so a rename on the compiler side breaks the
 * build rather than silently making this documentation wrong.
 */
import type {
  AssetTargetConfig,
  CatalogFormatContext,
  CompilerOptions,
  LogLevel,
  ZintlFacet,
} from "@zintl/compiler";

/**
 * What a user may write in `facets: [...]`.
 *
 * Accepts the `"auto"` sentinel (expanded by framework detection), bare facets,
 * arrays, and thunks — all flattened during assembly before resolution.
 *
 * @example
 * ```ts
 * zintl({ facets: ["auto", myFacet()] })          // keep the defaults, add one
 * zintl({ facets: [reactFacet(), ssrFacet()] })   // opt out of "auto" entirely
 * zintl({ facets: [() => expensiveFacet()] })     // thunk, evaluated at assembly
 * ```
 */
export type FacetsInput =
  | "auto"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | FacetsInput[];

/**
 * Options for the Zintl Vite plugin.
 *
 * Every field is optional; the defaults are tuned for a typical app, and a
 * working setup is usually just `locales`.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import zintl from "zintl/vite";
 *
 * export default defineConfig({
 *   plugins: [zintl({ locales: ["en", "ar", "fr"] })],
 * });
 * ```
 */
export interface Options {
  /**
   * The locale your source code is written in.
   *
   * This locale is **diskless**. Zintl never writes a catalog for it: a file of
   * `{ "Hello": "Hello" }` carries no information, so the compiler virtualizes
   * it from the extraction manifest instead. You will not find it in
   * {@link Options.outputDir | `outputDir`}, and that is not a bug.
   *
   * @default "en"
   */
  sourceLocale?: string;

  /**
   * Every locale the app ships, including {@link Options.sourceLocale | `sourceLocale`}.
   *
   * Each entry gets a catalog written under {@link Options.outputDir | `outputDir`}
   * (except the source locale), and becomes a value you can pass to `zintl()`.
   *
   * @default ["en"]
   * @example
   * ```ts
   * locales: ["en", "ar", "fr"]
   * ```
   */
  locales?: string[];

  /**
   * Where translation catalogs are written, relative to the project root.
   *
   * These files are yours: commit them, edit them, hand them to translators.
   * The compiler writes new keys in and reconciles renames, but never discards
   * a translation you have written (see {@link Options.prune | `prune`}).
   *
   * @default "./zintl"
   */
  outputDir?: string;

  /**
   * How catalog files are named inside {@link Options.outputDir | `outputDir`}.
   *
   * A token string, or a function returning a path relative to `outputDir`.
   * Supported tokens:
   *
   * - `[locale]` — the target locale, e.g. `ar`
   * - `[path]` — the boundary's source path, e.g. `src/pages/Home.ts`
   * - `[dir]` — its directory, e.g. `src/pages` (empty for the root)
   * - `[name]` — its filename with extension, e.g. `Home.ts`
   * - `[func]` — the enclosing function, for anchors nested inside one (empty otherwise)
   * - `[bId]` — the full boundary id; `:` and `/` become `_`
   * - `[hash]` — the boundary's stable short hash
   *
   * Grouping many boundaries into one file is supported: point several at the
   * same name and they are merged.
   *
   * @default `<path>[.<func>].<locale>.json`, e.g. `src/pages/Home.ts.ar.json`
   * @example
   * ```ts
   * catalogFormat: "[locale]/[dir]/[name].json"  // ar/src/pages/Home.ts.json
   * catalogFormat: "[locale].json"               // one file per locale
   * catalogFormat: ({ locale, name }) => `${locale}/${name}.json`
   * ```
   */
  catalogFormat?: string | ((ctx: CatalogFormatContext) => string);

  /**
   * How similar an edited string must be to a remembered one before its
   * translation is carried forward instead of being dropped.
   *
   * A ratio from `0` to `1`. Fixing a typo in a source string is the case this
   * exists for: the translation moves to the new key and no translator is
   * involved. Raising it toward `1` demands near-identical strings and loses
   * more translations to small edits; lowering it risks a translation landing on
   * an unrelated string.
   *
   * Escape hatch — the default is usually right, and a threshold cannot fix a
   * string that was genuinely rewritten.
   *
   * @default 0.6
   */
  similarityThreshold?: number;

  /**
   * How much Zintl prints.
   *
   * The `ZINTL_LOG_LEVEL` environment variable overrides this when set. Under
   * test (`NODE_ENV=test` or Vitest) the effective level is `"silent"` unless
   * {@link Options.debug | `debug`} is on.
   *
   * @default Vite's own `logLevel`, falling back to `"info"`
   */
  logLevel?: LogLevel;

  /**
   * Where the compiler keeps its own bookkeeping — the extraction manifest,
   * boundary graph and translation hive.
   *
   * Build artifacts, not source. They live outside your repo by default and you
   * should not need to move them.
   *
   * Escape hatch — mainly useful for test harnesses and sandboxes.
   *
   * @default `<root>/node_modules/.zintl`
   */
  metadataDir?: string;

  /**
   * Verbose compiler tracing.
   *
   * `true` enables everything. A **string** is a scope filter, matched against
   * the prefix of each debug channel, so you can watch one subsystem instead of
   * the whole pipeline. The `DEBUG` environment variable (`DEBUG=zintl:*`,
   * `DEBUG=*`, or `DEBUG=zintl:<prefix>`) turns the same tracing on.
   *
   * @default false
   * @example
   * ```ts
   * debug: true          // everything
   * debug: "boundary"    // only the boundary-graph channels
   * ```
   */
  debug?: boolean | string;

  /**
   * Remove keys from catalogs once no source string produces them.
   *
   * On by default, so deleting a component takes its dead keys with it. Turn it
   * off if catalogs are edited by a system that expects keys to survive their
   * source — the cost is that catalogs only ever grow.
   *
   * Pruning runs after reconciliation, so a renamed or retyped string is carried
   * forward rather than pruned and re-added.
   *
   * @default true
   */
  prune?: boolean;

  /**
   * Verify on-disk catalogs against the extraction manifest and repair drift.
   *
   * The check that catches a hand-edited catalog that no longer matches the
   * code. It costs a pass over every catalog, which is why it is on for builds
   * and off while serving.
   *
   * Escape hatch — set `false` to skip it in a slow CI build, `true` to catch
   * drift during development.
   *
   * @default `true` for `vite build`, `false` for `vite dev`
   */
  verifyIntegrity?: boolean;

  /**
   * Build every locale as its own set of HTML entries, instead of one app that
   * loads catalogs at runtime.
   *
   * Detected automatically: an anchor written `zintl()` or `zintl("*")` defers
   * the locale to the document or the URL, which is exactly the multiplex shape,
   * so the plugin scans your entries and decides.
   *
   * Escape hatch — set it explicitly only when the scan gets it wrong.
   *
   * @default auto-detected from your entry files
   */
  multiplex?: boolean;

  /**
   * Static content files to localize alongside your code, as extensions or
   * glob configs.
   *
   * A bare extension expands to `**\/*.<ext>`. When a target's
   * {@link AssetTargetConfig.strategy | `strategy`} is not given it is inferred
   * from the extension: `.md`/`.mdx` merge frontmatter, `.txt` passes through as
   * text, anything else is copied as binary.
   *
   * @default ["md", "txt"]
   * @example
   * ```ts
   * assetsTarget: ["md", "txt", "mdx"]
   * assetsTarget: [{ targetPattern: "content/**\/*.md", outputPattern: "[locale]/[dir]/[name][ext]" }]
   * ```
   */
  assetsTarget?: (string | AssetTargetConfig)[];

  /**
   * Serve localized assets from virtual modules instead of writing them to disk.
   *
   * With the default (`false`), a localized copy of each matched asset is
   * written next to your catalogs, so you can read and edit the translated
   * Markdown directly. With `true` nothing is written: the localized content is
   * kept in the translation hive and served through virtual modules, which keeps
   * the working tree clean at the cost of not being able to edit the output as a
   * file.
   *
   * @default false
   */
  virtualAssets?: boolean;

  /**
   * Which capabilities the compiler is built with — framework support, SSR,
   * client locale sync, asset handling.
   *
   * `"auto"` covers almost every project. It detects your framework from the
   * Vite plugins and `package.json`, then adds the baselines: vanilla DOM and
   * HTML extraction, static assets, client-side locale sync for SPAs, and SSR
   * wrapping for SSR builds. The Vite bundler facet is always appended and
   * cannot be opted out of.
   *
   * Listing facets without `"auto"` opts out of all of that and gives you
   * exactly what you name. Two facets that claim the same file extension, or
   * that provide the same hook at the same priority, are a hard error rather
   * than a silent winner.
   *
   * @default ["auto"]
   * @example
   * ```ts
   * facets: ["auto", myMarkdownFacet()]   // defaults plus your own
   * facets: [reactFacet(), ssrFacet()]    // exactly these, nothing implicit
   * ```
   */
  facets?: FacetsInput[];
}

type Assert<T extends true> = T;

/**
 * Compile-time guard: every option the compiler accepts must still be spelled
 * out on {@link Options}.
 *
 * `Options` is written by hand rather than extending `CompilerOptions`, so this
 * fails the build if the compiler grows, renames or retypes an option that the
 * plugin surface has not caught up with.
 *
 * @internal
 */
type _OptionsCoversCompiler = Assert<
  Omit<CompilerOptions, "capabilities"> extends Options ? true : false
>;
