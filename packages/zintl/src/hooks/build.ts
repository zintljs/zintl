import type { ZintlPluginContext } from "../context.js";

export function buildStartHook(ctx: ZintlPluginContext) {
  return async function () {
    ctx.compiler._logger.withPrefix("Vite").debug("Build starting...");
    await ctx.compiler.setup();
    if (!ctx.server) {
      // Discovery pass for production builds
      await ctx.compiler.discover();
    }
  };
}

export function buildEndHook(ctx: ZintlPluginContext) {
  return async function () {
    await ctx.compiler.flush();
  };
}
