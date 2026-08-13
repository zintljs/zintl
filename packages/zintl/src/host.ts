/**
 * What the plugin needs to know about its host build tool, and the one place a
 * compiler is constructed.
 *
 * Construction used to live in `configResolvedHook`, which reads a Vite
 * `ResolvedConfig`. That was invisible as a coupling for as long as Vite was the
 * only host: unplugin drops the entire `vite: {}` block of a plugin on every
 * other target (see `plugin.ts`), so on any non-Vite bundler `configResolved`
 * never fires and `ctx.compiler` is never assigned — every subsequent hook then
 * fails on `undefined`, which reads as a broken plugin rather than as a missing
 * seam.
 *
 * So the sequence — detect → assemble → resolve → construct — lives here,
 * behind a host view that any bundler can populate, and `configResolvedHook`
 * becomes one of its callers rather than its owner.
 */
import { ZintlCompiler, type LogLevel } from "@zintljs/compiler";
import { resolveFacets } from "./facets/resolve.js";
import { detectFrameworks } from "./facets/detect.js";
import { assembleFacets } from "./facets/assemble.js";
import type Context from "./context.js";

/**
 * The facts about a host build tool that compiler construction depends on.
 *
 * Deliberately minimal. Every field here is something only the host can answer,
 * and nothing here is derivable from another field — `verifyIntegrity`, for
 * one, used to be passed around separately and is simply `!isDev`, so it is not
 * a member. Anything a facet eventually needs to ask about its host should be
 * added by argument, not by accretion.
 */
export interface BundlerHostView {
  /** Project root. Absolute. */
  root: string;
  /**
   * Which build tool is hosting the plugin — `"vite"`, `"rspack"`, …
   *
   * Proposal 026 §9 Q4 asked whether a facet's detection context needs to see
   * the bundler. It does: with a second host in play, the bundler facets are
   * the clearest case of facets that must decide for themselves rather than be
   * appended unconditionally by core.
   */
  bundler: string;
  /** Serving rather than building — Vite's `command === "serve"`. */
  isDev: boolean;
  /** This is an SSR build, so the SSR facets apply. */
  isSsr: boolean;
  /**
   * Names of the host's other plugins, used as a framework-detection signal.
   * Empty is fine — detection falls back to scanning `package.json`.
   */
  pluginNames: string[];
  /** The host's own log level, if it has one. */
  logLevel?: LogLevel;
}

/**
 * The host view for a bundler that has told us nothing.
 *
 * Used by the universal hooks as a safety net so that a host without a config
 * hook still gets a working compiler rather than a `TypeError`. It is never
 * reached on Vite: `configResolved` runs before `buildStart` and before any
 * `resolveId`, and {@link ensureCompiler} is idempotent, so the Vite path always
 * keeps the view Vite actually resolved.
 *
 * Deriving a real view from a foreign bundler's native build context is host
 * work, and belongs in whichever facet or entry point knows that bundler.
 */
function fallbackHostView(): BundlerHostView {
  return {
    root: process.cwd(),
    bundler: "unknown",
    isDev: false,
    isSsr: false,
    pluginNames: [],
  };
}

/**
 * Build a host view from whatever the host's own plugin context exposes,
 * falling back to {@link fallbackHostView} when it exposes nothing useful.
 *
 * The fallback's `process.cwd()` is not a harmless default, and that was
 * measured rather than reasoned about: on Rspack — where `configResolved` never
 * runs — a compiler rooted at `process.cwd()` discovered the entire monorepo
 * from the directory the test runner happened to start in. 217 boundaries,
 * including `coverage/index.html` and every example app, and a manifest large
 * enough that `JSON.stringify` exceeded V8's maximum string length.
 *
 * So a host that has a real root must be asked for it. Unplugin exposes one
 * through `getNativeBuildContext()`, whose shape is per-framework; each branch
 * here reads only that framework's own documented field.
 */
export function nativeHostView(pluginContext: unknown): BundlerHostView {
  const base = fallbackHostView();
  const getNative = (pluginContext as { getNativeBuildContext?: () => unknown } | undefined)
    ?.getNativeBuildContext;
  if (typeof getNative !== "function") return base;

  const native = getNative.call(pluginContext) as
    | { framework?: string; compiler?: { options?: { context?: string; mode?: string } } }
    | undefined;

  const bundler = typeof native?.framework === "string" ? native.framework : base.bundler;

  /**
   * `mode` is this family's `command === "serve"` — on raw webpack and raw
   * Rspack, where the user sets it.
   *
   * It is **not** sufficient under Rsbuild, and that was measured rather than
   * assumed: Rsbuild leaves `mode` at `"none"` for `dev`, `build` and
   * `preview` alike, because it drives optimisation from its own config rather
   * than from webpack's mode presets. So this answers `false` on an Rsbuild dev
   * server, the runtime is generated with `__ZINTL_DEV__` folded to `false`,
   * and the page has no settle beacon and no dev logging — while rendering and
   * translating perfectly, which is why it went unnoticed (ledger L-020).
   *
   * Dev-ness is a fact the *Rsbuild* layer owns and the Rspack layer cannot
   * see. It arrives through {@link Context.hostHints}, set from
   * `api.context.action` in the plugin's `rsbuild` block, and is merged over
   * this view below. Kept here rather than deleted because it is still correct
   * for a host that drives Rspack directly.
   */
  const isDev = native?.compiler?.options?.mode === "development";

  // Rspack (and webpack, which shares the shape): the project root is the
  // compiler's `context`.
  const context = native?.compiler?.options?.context;
  if (typeof context === "string" && context.length > 0) {
    return { ...base, bundler, isDev, root: context };
  }

  return { ...base, bundler, isDev };
}

/**
 * Construct the compiler if it does not exist yet, and return it either way.
 *
 * Idempotent by design: several universal hooks call this defensively, and the
 * first caller to arrive with a real host view is the one that wins. That
 * ordering is the reason the Vite path is unaffected — `configResolved` is
 * always first.
 */
export function ensureCompiler(
  ctx: Context,
  host: BundlerHostView | (() => BundlerHostView),
): ZintlCompiler {
  if (ctx.compiler) return ctx.compiler;

  /**
   * Resolved *after* the early return, which is the whole reason it may be a
   * thunk.
   *
   * The universal hooks call this defensively on every `resolveId`, `load` and
   * `transform`, so building a host view eagerly meant asking the bundler for
   * its native build context on every module of every build — work whose result
   * is discarded on all but the first call. Measured cost: enough to make the
   * HMR-hammer contract miss its final update on `react-basic`.
   */
  const native = typeof host === "function" ? host() : host;

  /**
   * Hints last, because they come from the layer that knows better. A stacked
   * host answers through both: `getNativeBuildContext()` for what the inner
   * bundler owns, {@link Context.hostHints} for what only the outer one can
   * say. Nothing is written into `hostHints` that the inner layer supplied, so
   * this is a completion rather than an override.
   */
  const resolved: BundlerHostView = { ...native, ...ctx.hostHints };

  // Orchestration, in three visible steps: detect → assemble → resolve.
  const frameworks = detectFrameworks({
    pluginNames: resolved.pluginNames,
    root: resolved.root,
  });

  const facets = assembleFacets({
    frameworks,
    bundler: resolved.bundler,
    ssr: resolved.isSsr,
    isDev: resolved.isDev,
    root: resolved.root,
    pluginNames: resolved.pluginNames,
    facets: ctx.options.facets,
    assetsTarget: ctx.options.assetsTarget,
    virtualAssets: ctx.options.virtualAssets,
  });

  // The compiler is handed the result and never learns which facets produced it.
  const capabilities = resolveFacets(facets);

  /**
   * Fence for ledger L-022. Multiplex's per-locale HTML fan-out exists only in
   * loadHook/resolveIdHook's Vite-shaped branches (hooks/resolve.ts). A bundler
   * facet that has not declared `htmlFanOut` cannot survive those branches
   * firing — on Rspack, loadIncludeHook claiming ".html" retypes the raw
   * template as `javascript/auto` and the build dies inside
   * html-rspack-plugin's child compilation, with an error naming a loader
   * chain rather than Zintl. Ask the facet, and fail loudly before any module
   * resolution happens, rather than let the host's own crash stand in for ours.
   */
  if (ctx.getMultiplex({ root: resolved.root }) && !capabilities.flags.htmlFanOut) {
    throw new Error(
      `[Zintl] Multiplex is not supported on "${resolved.bundler}": its bundler facet declares no ` +
        `HTML fan-out support, so Zintl cannot produce the per-locale HTML documents multiplex ` +
        `requires (see docs/spec/proposals/027-leak-ledger.md, L-022). Set \`multiplex: false\` in ` +
        `your Zintl options to opt out explicitly, or remove the sovereign anchor ` +
        `(\`zintl("*")\` / \`zintl()\`) that auto-detection found, until multiplex ships for this bundler.`,
    );
  }

  ctx.compiler = new ZintlCompiler(
    {
      ...ctx.options,
      capabilities,
      // The two host-dependent defaults, each applied exactly once. Everything
      // else was already resolved by resolveOptions() at plugin creation.
      logLevel: ctx.options.logLevel ?? resolved.logLevel ?? "info",
      verifyIntegrity: ctx.options.verifyIntegrity ?? !resolved.isDev,
      /**
       * Declared by the host before compilation starts, and empty on every host
       * whose templates name their own scripts — which is all of them except
       * Rsbuild. See `hooks/html.ts` and ledger L-021.
       */
      htmlEntries: ctx.htmlEntries,
    },
    resolved.root,
    resolved.isDev,
  );

  return ctx.compiler;
}
