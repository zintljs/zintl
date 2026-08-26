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
} from "@zintljs/compiler";

/**
 * What a user may write in `facets: [...]`.
 *
 * Accepts the `"builtins"` sentinel (the built-in facet set), bare facets,
 * arrays, and thunks — all flattened during assembly before resolution.
 *
 * @example
 * ```ts
 * zintl({ facets: ["builtins", myFacet()] })      // the built-in set, plus yours
 * zintl({ facets: [reactFacet(), ssrFacet()] })   // exactly these, nothing implicit
 * zintl({ facets: [() => expensiveFacet()] })     // thunk, evaluated at assembly
 * ```
 */
export type FacetsInput =
  | "builtins"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | { readonly __zintlExclude: string }
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
 * import zintl from "zintljs/vite";
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
   * While serving, render an untranslated string as visibly-pseudo-localized
   * text — `⟦Ẇéļçöṁé ƀàçķ!⟧` — instead of an empty one.
   *
   * The default exists because of what the alternative looks like. With
   * catalogs written but not yet filled, switching locale used to blank the
   * page: {@link Options.verifyIntegrity | `verifyIntegrity`} is off while
   * serving, and a missing key resolves to `""`. Nothing was broken and nothing
   * said anything — the app just emptied.
   *
   * This is **not** a fallback to the source locale, and the distinction is the
   * whole design. The text is deliberately unmistakable, so it can never pass
   * for a translation or reach production: it is inside the `__ZINTL_DEV__`
   * guard, so a build folds the branch away and the transform with it.
   * `verifyIntegrity` still fails that build.
   *
   * Placeholders and markup are left alone, and the result goes through normal
   * interpolation — `{count}` shows the real count, and tags render as tags. So
   * the page keeps its layout and only the words announce themselves.
   *
   * @default true
   */
  pseudoLocalize?: boolean;

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
   * Extraction targets to add on top of whatever the active facets detect.
   *
   * **Additive, and the name says so.** `targets` on a facet *replaces* that
   * facet's list, which is right for reconfiguring one but wrong for "I want
   * one more" — re-listing every default to append a single entry means your
   * config silently falls behind whenever the defaults move. This adds.
   *
   * The common case is a shape your codebase repeats that no default can infer:
   *
   * ```ts
   * zintl({ additionalTargets: ["obj:details:*"] })
   * ```
   *
   * Every descriptor form is accepted — see `docs/configuration.md`. `*` works
   * in either position: `obj:*:title` is any object's `title`, `obj:details:*`
   * is every field of an object named `details`.
   *
   * Adding a target widens what your build treats as user-facing, and you own
   * the consequences: a string that should not have been translated comes back
   * translated at runtime, and fails the build until somebody translates it.
   * `@zintl-ignore` opts a single site back out.
   *
   * @default []
   */
  additionalTargets?: string[];

  /**
   * Which capabilities the compiler is built with — framework support, SSR,
   * client locale sync, asset handling.
   *
   * `"builtins"` covers almost every project. It does not mean "guess what I
   * need" — it puts the built-in facets on the table, and each one decides for
   * itself whether it applies: the React facets ask for React, the SSR facets
   * ask for an SSR build, the Vite facet asks whether Vite is the host.
   *
   * The list is additive, so naming your own facet alongside it disturbs
   * nothing. Omitting `"builtins"` gives you exactly what you name — with one
   * exception: the bundler facet for your host stays a candidate, because
   * opting out of the built-in set should not silently strip the integration
   * that makes the plugin work at all.
   *
   * To keep the set but drop one member, use `excludeFacet(name)` rather than
   * re-listing everything. To keep it but *reconfigure* one member, pass your
   * own facet under that member's name — it replaces the built-in, on either
   * side of the sentinel, and the activation trace names the one it replaced.
   *
   * A facet you write has **no condition by default**, so it applies always —
   * you added it on purpose. Declare `when` if it should not. Two facets that
   * claim the same file extension, or provide the same hook at the same
   * priority, are a hard error rather than a silent winner.
   *
   * @default ["builtins"]
   * @example
   * ```ts
   * facets: ["builtins", myMarkdownFacet()]        // the built-in set, plus yours
   * facets: ["builtins", excludeFacet("client-spa")] // all but one
   * facets: [reactFacet(), ssrFacet()]             // exactly these, nothing implicit
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
