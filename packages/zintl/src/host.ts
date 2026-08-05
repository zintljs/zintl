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
import { detectFrameworksOrFallback } from "./facets/detect.js";
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
    | { framework?: string; compiler?: { options?: { context?: string } } }
    | undefined;

  // Rspack (and webpack, which shares the shape): the project root is the
  // compiler's `context`.
  const context = native?.compiler?.options?.context;
  if (typeof context === "string" && context.length > 0) {
    return { ...base, root: context };
  }

  return base;
}

/**
 * Construct the compiler if it does not exist yet, and return it either way.
 *
 * Idempotent by design: several universal hooks call this defensively, and the
 * first caller to arrive with a real host view is the one that wins. That
 * ordering is the reason the Vite path is unaffected — `configResolved` is
 * always first.
 */
export function ensureCompiler(ctx: Context, host: BundlerHostView): ZintlCompiler {
  if (ctx.compiler) return ctx.compiler;

  // Orchestration, in three visible steps: detect → assemble → resolve.
  const frameworks = detectFrameworksOrFallback({
    pluginNames: host.pluginNames,
    root: host.root,
  });

  const facets = assembleFacets({
    frameworks,
    ssr: host.isSsr,
    facets: ctx.options.facets,
    assetsTarget: ctx.options.assetsTarget,
    virtualAssets: ctx.options.virtualAssets,
  });

  // The compiler is handed the result and never learns which facets produced it.
  const capabilities = resolveFacets(facets);

  ctx.compiler = new ZintlCompiler(
    {
      ...ctx.options,
      capabilities,
      // The two host-dependent defaults, each applied exactly once. Everything
      // else was already resolved by resolveOptions() at plugin creation.
      logLevel: ctx.options.logLevel ?? host.logLevel ?? "info",
      verifyIntegrity: ctx.options.verifyIntegrity ?? !host.isDev,
    },
    host.root,
    host.isDev,
  );

  return ctx.compiler;
}
