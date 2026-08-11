import type Context from "../context.js";
import { ensureCompiler, nativeHostView } from "../host.js";

/**
 * Run the discovery pass once per process, and make every other caller wait for
 * that one rather than start a second or skip ahead.
 *
 * Both halves are load-bearing, and each was learned by breaking it:
 *
 * - **Once per process.** The guard used to be `!ctx.server`, a field only
 *   Vite's `configureServer` assigns, standing in for "have I discovered yet".
 *   On Vite the two agree, because `buildStart` runs once there either way. On a
 *   host that taps `buildStart` to `compiler.hooks.make` — once per
 *   *compilation* — it meant every incremental rebuild re-discovered the whole
 *   project. Ledger L-024.
 * - **Share the promise, don't just set a flag.** Setting `discovered = true`
 *   before awaiting looks equivalent and is not: `hooks.make` is parallel, so
 *   Rspack starts building modules while this is still running, and the second
 *   caller sailed straight past into a null boundary graph. Handing back the
 *   same in-flight promise is the shape `invalidateForUpdate` already uses for
 *   the same reason (ZDB Axiom D3) — what is shared is the work, not a result
 *   that does not exist yet.
 */
export function ensureDiscovered(ctx: Context): Promise<void> {
  const state = ctx as unknown as { discoveryPromise?: Promise<void>; discovered?: boolean };
  if (!state.discoveryPromise) {
    state.discoveryPromise = ctx.compiler
      .discover()
      .catch((err: NodeJS.ErrnoException) => {
        /**
         * A missing catalog directory is not a failure in dev — it is a project
         * that has not been built yet, and `flush()` is about to create it. A
         * build has no such excuse.
         */
        if (!ctx.compiler.isDev || err?.code !== "ENOENT") throw err;
      })
      .then(() => {
        state.discovered = true;
      });
  }
  return state.discoveryPromise;
}

export function buildStartHook(ctx: Context) {
  return async function (this: unknown) {
    /**
     * `buildStart` is the first *universal* hook to run, so on a host without a
     * config hook this is where the compiler comes into existence. On Vite it is
     * a no-op: `configResolved` has already run and `ensureCompiler` is
     * idempotent, so the real host view wins.
     */
    ensureCompiler(ctx, () => nativeHostView(this));

    ctx.compiler._logger.withPrefix("Vite").debug("Build starting...");
    await ctx.compiler.setup();
    await ensureDiscovered(ctx);
  };
}

export function buildEndHook(ctx: Context) {
  return async function () {
    await ctx.compiler.flush();
  };
}
