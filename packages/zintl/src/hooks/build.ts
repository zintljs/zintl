import type Context from "../context.js";
import { ensureCompiler, nativeHostView } from "../host.js";

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
    if (!ctx.server) {
      // Discovery pass for production builds
      await ctx.compiler.discover();
      (ctx as any).discovered = true;
    }
  };
}

export function buildEndHook(ctx: Context) {
  return async function () {
    await ctx.compiler.flush();
  };
}
