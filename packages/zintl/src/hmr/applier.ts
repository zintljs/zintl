import type { HotUpdatePlan } from "./types.js";

/**
 * What applying a plan produced.
 *
 * `count` is for the trace and is universal. `hostModules` exists because Vite's
 * hot-update hook has a *return contract* — hand back the modules you want
 * updated, or the ones you were given — and Rspack's `watchRun` has none. A host
 * with nothing to hand back omits it.
 */
export interface HostUpdateResult {
  count: number;
  hostModules?: unknown;
}

/**
 * The seam proposal 028 §6.1 asked for: _given the compiler's decision, apply it
 * to this host's live graph._
 *
 * Every other bundler-specific concern in this codebase is mediated by a
 * `BundlerFacet`. HMR was the one place that promise was not kept — the
 * orchestration lived inside `plugin.ts`'s `vite: {}` escape hatch, and that it
 * never ran on any other host was an accident of unplugin dropping that block,
 * not a decision anything had declared.
 *
 * **Why this is not a `BundlerFacet` hook.** A facet lives in
 * `@zintljs/compiler`, and nothing bundler-specific belongs there — an applier
 * is nothing *but* bundler-specific: Vite's `ModuleGraph`, Rspack's virtual file
 * store. It follows the precedent `hooks/html.ts` set for `modifyHTML` (027
 * §2.5): the host-neutral decision belongs to the compiler, and the code that
 * speaks the host's API belongs to `packages/zintl`, registered from that host's
 * own escape hatch. `BundlerFacet.hotUpdate` is the facet's half — the
 * *declaration* that this bundler has an applier, which is the part core and the
 * composition guardrail can see.
 *
 * **How one gets chosen.** It is not chosen; it is *contributed*. Vite's is
 * registered from `configureServerHook`, Rspack's from the plugin's
 * `rspack(compiler)` block. There is no `switch (bundler)` anywhere, which is
 * deliberate — 026 §8 names accumulating host branches in shared code as the
 * anti-pattern that ends in "two integrations wearing one name".
 */
export interface HostUpdateApplier {
  /** The host this speaks for. Matched against the resolved bundler by the fence. */
  readonly name: string;

  /**
   * Re-evaluate everything the plan names, in this host's live module graph.
   *
   * Returns how many modules were actually reached, which the caller reports on
   * the HMR trace. Zero is a real answer and a diagnostic one: it means the plan
   * described work no module in this graph corresponds to.
   *
   * `hostContext` carries whatever the host's own hook handed over that the plan
   * cannot express — Vite's `{ moduleGraph, modules, timestamp }`, nothing at all
   * on Rspack, whose `watchRun` reports changed files and works out module scope
   * itself. Deliberately `unknown`, the same posture `LabDevServerHandle.native`
   * takes: reaching into it is a host-specific act and should look like one at
   * the call site.
   */
  apply(plan: HotUpdatePlan, hostContext?: unknown): Promise<HostUpdateResult> | HostUpdateResult;

  /**
   * The second invalidation path, driven from `transform` rather than from a
   * hot-update event.
   *
   * Kept separate rather than folded into {@link apply} because its caller has a
   * boundary but no event — there is no changed file and no host sequence, only
   * a module the host has just asked to transform. Whatever ordering token this
   * needs is therefore the applier's to supply, which is the honest place for it:
   * it is a fact about how this host cache-busts, not about the update.
   */
  applyChunkInvalidation(boundaryId: string, hostContext?: unknown): void;

  /**
   * Tell the browser to reload the page.
   *
   * Every host has some form of this and no two spell it alike: Vite sends a
   * `full-reload` payload over its own websocket, Rsbuild exposes `sockWrite` on
   * its dev server. A no-op is an acceptable implementation for a host with no
   * channel — the update is simply not observable, which is honest.
   */
  sendFullReload(): void;
}
