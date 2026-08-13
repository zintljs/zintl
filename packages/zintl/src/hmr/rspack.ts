import type Context from "../context.js";
import type { HostUpdateApplier, HostUpdateResult } from "./applier.js";
import type { HotUpdatePlan } from "./types.js";

/**
 * Rspack's half of the seam.
 *
 * The striking thing about this file is how little it does, and that is the
 * finding rather than an omission. Vite's applier has to *tell* the module graph
 * what to re-evaluate, because Vite's hot-update hook hands Zintl an event and
 * expects a module list back. Rspack works the other way round: it rebuilds
 * whatever its own dependency graph says is stale, so the equivalent work is not
 * done here at all — it is done once, earlier, by declaring the dependency.
 *
 * Concretely, `generateVirtualModule` reports `getBoundaryInputs(boundaryId)` as
 * `watchedFiles`, `loadHook` forwards those to `addWatchFile`, and unplugin maps
 * that to `loaderContext.addDependency`. A source edit then rebuilds the source
 * module *and* the generated content and manager modules in one compilation,
 * because Rspack already knows they are related. Nothing has to be invalidated
 * by hand, and — measured against the alternative — nothing should be: poking
 * the watcher from `watchRun` (via `VirtualModulesPlugin.writeModule`, which is
 * the supported way to do it) lands in the *next* compilation rather than this
 * one, so it costs a second build per keystroke and shows the page a stale
 * catalog in between.
 *
 * What is left is the part Rspack genuinely cannot infer: that some updates are
 * not patchable at all and need the page back.
 */
export class RspackUpdateApplier implements HostUpdateApplier {
  readonly name = "rspack";

  constructor(private readonly ctx: Context) {}

  /**
   * Rsbuild's documented dev-server channel. Absent under raw Rspack, and absent
   * before `onBeforeStartDevServer` has run — both are honest "no channel", and
   * the alternative to a silent no-op would be inventing a websocket Zintl does
   * not own.
   */
  sendFullReload(): void {
    this.ctx.rsbuildServer?.sockWrite("full-reload", { path: "*" });
  }

  /**
   * A no-op, and deliberately not left unimplemented.
   *
   * On Vite this path exists because `transform` can learn that a boundary's
   * chunks are stale at a moment when no hot-update event is in flight, and
   * Vite's graph will not notice on its own. Rspack is *already* rebuilding the
   * module that triggered this — that is why `transform` is running — and the
   * generated modules that depend on it are in the same compilation's stale set.
   * There is nothing to add.
   */
  applyChunkInvalidation(): void {}

  apply(plan: HotUpdatePlan): HostUpdateResult {
    if (plan.fullReload) this.sendFullReload();
    /**
     * Zero is the truthful count: this host re-evaluates modules by its own
     * dependency graph, so the number Zintl reached directly really is none. The
     * trace says so rather than reporting a figure invented to look busy.
     */
    return { count: 0 };
  }
}
