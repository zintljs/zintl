import type Context from "../context.js";

export function buildStartHook(ctx: Context) {
  return async function () {
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
