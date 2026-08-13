/**
 * The vocabulary a hot update is described in, before any host sees it.
 *
 * Nothing here names a bundler, a module graph, or a hook signature. That is the
 * whole point: proposal 028 §6.1 found that `hooks/hmr.ts` split cleanly in two
 * — deciding *what changed*, which is plain `@zintljs/compiler` calls, and
 * telling *this host's live module graph* about it, which was Vite's
 * `ModuleNode`/`ModuleGraph` vocabulary and had nowhere else to live. These
 * types are the interface between those halves.
 */

/**
 * What kind of file changed, which decides how the compiler is asked about it.
 *
 * - `source` — a `.ts`/`.tsx`/`.js`/`.jsx`/`.html`/`.vue`/`.svelte` file. Its
 *   content is re-extracted, so the event carries the content the host saw.
 * - `json` — a catalog. Forced invalidation; no content, the compiler reads it.
 * - `asset` — a `.md`/`.txt` localized asset. Registered with the asset manager
 *   before invalidation.
 *
 * Anything else is not eligible and produces no event at all.
 */
export type HotUpdateKind = "source" | "json" | "asset";

export interface HotUpdateEvent {
  /** Absolute path of the file the host reported. */
  file: string;
  /**
   * The host's own hot-update sequence for this event.
   *
   * Load-bearing, and it must come from the host rather than from Zintl — ZDB
   * §7a: _"do not emulate them with a counter of your own, because a second
   * clock that can disagree with the bundler's is worse than no clock at all."_
   * On Vite this is `HmrContext.timestamp`, already travelling to the browser as
   * `?t=`. On Rspack it is `Watching.startTime`, the compilation's own clock.
   */
  seq: number;
  kind: HotUpdateKind;
  /**
   * The content the host saw for **this** event, where the host can supply it.
   *
   * Undefined means "read it yourself" — which the compiler will, and which is
   * the weaker guarantee: an independent read races a later write. See
   * `HostUpdateApplier` implementations for how each host answers this.
   */
  content?: string;
  /**
   * How many modules the host handed over with the event, where it hands any.
   *
   * Diagnostic only, and optional because it is a Vite-shaped fact: `hotUpdate`
   * passes a `modules` array, Rspack's `watchRun` passes a changed-file set and
   * decides module scope itself.
   */
  modulesLength?: number;
}

/**
 * One boundary the event touched, with everything the compiler knows about it.
 *
 * A host applier consumes this; it never queries the compiler itself. Each field
 * is an *id*, not a module — turning ids into whatever this host calls a module
 * is precisely the work the applier exists to do.
 */
export interface BoundaryUpdate {
  boundaryId: string;
  /**
   * Chunk module ids whose generated catalogs this boundary feeds
   * (`compiler.getAffectedChunks`). These match generated module ids by
   * substring, not by equality — the host's id for a generated module embeds
   * the chunk id rather than equalling it.
   */
  chunkIds: string[];
  /** The boundary's own source file, as the compiler names it. */
  fileId?: string;
  /** {@link fileId} resolved against the compiler root. */
  absFileId?: string;
  /**
   * Entry source paths, for the `b_assets` fan-out.
   *
   * `b_assets` is a synthetic boundary with no file of its own, so an asset edit
   * has to reach every *entry* instead. Empty for every real boundary.
   */
  entryFilePaths: string[];
}

export interface HotUpdatePlan {
  event: HotUpdateEvent;
  boundaries: BoundaryUpdate[];
  /**
   * The host must reload the page rather than patch it.
   *
   * Set for an HTML boundary — the document itself changed — and for a
   * server-only boundary, whose update the client cannot observe by any other
   * means.
   */
  fullReload: boolean;
  /**
   * A catalog edit the compiler could not attribute to any boundary.
   *
   * The fallback is to re-evaluate every generated manager, which is broad but
   * bounded, and it is what makes a hand-edited translation land at all when the
   * graph cannot say which boundary owns it.
   */
  invalidateAllManagers: boolean;
}
