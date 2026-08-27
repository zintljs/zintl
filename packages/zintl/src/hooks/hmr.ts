import type Context from "../context.js";
import { classifyFile, computeHotUpdatePlan } from "../hmr/plan.js";
import { ViteUpdateApplier, type ViteHostContext } from "../hmr/vite.js";

/**
 * Vite's hot-update hook, reduced to what is actually Vite's about it.
 *
 * Everything this used to do beyond unpacking the hook payload now lives in one
 * of two places: `hmr/plan.ts` decides what changed, `hmr/vite.ts` tells Vite's
 * module graph about it. Proposal 029; the split line is the one 028 §6.1 drew.
 *
 * Registered twice in `plugin.ts`, under `handleHotUpdate` and `hotUpdate`,
 * because which one a given Vite version dispatches depends on the version — the
 * two payloads differ only in where the module graph lives, which is why the
 * shape is destructured rather than typed.
 */
export function handleHotUpdateHook(ctx: Context) {
  return async function (this: any, { file, server, modules, timestamp, read }: any) {
    /**
     * `configureServerHook` normally contributes this, and reusing what it
     * contributed is the point of the field. Falling back to constructing one is
     * not host selection — this hook is registered *only* inside `plugin.ts`'s
     * `vite: {}` block, so "the Vite hook uses the Vite applier" is a tautology
     * rather than a choice. What it buys is that the hook stays self-sufficient
     * when `configureServer` has not run, which is the shape every unit test in
     * `__tests__/*_hmr.test.ts` drives it in.
     */
    const applier = ctx.updateApplier ?? new ViteUpdateApplier(ctx, server);

    const kind = classifyFile(ctx, file);
    if (!kind) {
      ctx.hmrTrace.push({ ts: Date.now(), kind: "skip-ineligible", file });
      return;
    }

    /**
     * The sequence for this event, and the content it describes.
     *
     * `timestamp` is the bundler's own hot-update clock: strictly monotonic,
     * never repeating, and already travelling to the browser as `?t=` on
     * rewritten imports. Using it means the compiler and the browser order the
     * same event by the same number.
     *
     * `read()` hands back the content the bundler saw for *this* event. Letting
     * the compiler read the file itself instead is how a later write became a
     * no-op — the watcher is unqueued, so two rapid changes run concurrently and
     * both would read whatever happened to be on disk at that moment.
     */
    const seq = typeof timestamp === "number" ? timestamp : Date.now();
    let content: string | undefined;
    if (kind === "source" && typeof read === "function") {
      try {
        content = await read();
      } catch {
        // Fall back to a disk read inside the compiler — a file that cannot be
        // read here is usually one being rewritten, and the retry costs nothing.
      }
    }

    const environment = this && this.environment ? this.environment.name : undefined;

    const plan = await computeHotUpdatePlan(ctx, {
      file,
      seq,
      kind,
      content,
      modulesLength: modules?.length,
      environment,
    });
    if (!plan) return;

    const host: ViteHostContext = {
      moduleGraph: this && this.environment ? this.environment.moduleGraph : server.moduleGraph,
      modules,
      timestamp,
    };
    const result = await applier.apply(plan, host);

    if (result.count > 0) {
      ctx.hmrTrace.push({
        ts: Date.now(),
        kind: "return",
        file,
        invalidatedCount: result.count,
        modulesLength: modules?.length,
        environment,
        passthrough: false,
      });
      return result.hostModules;
    }

    ctx.hmrTrace.push({
      ts: Date.now(),
      kind: "return",
      file,
      invalidatedCount: 0,
      modulesLength: modules?.length,
      environment,
      passthrough: true,
    });
    return modules;
  };
}
