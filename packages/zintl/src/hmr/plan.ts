import { isAbsolute, join } from "node:path";
import type Context from "../context.js";
import type { AssetManager } from "@zintljs/compiler/facets";
import type { BoundaryUpdate, HotUpdateEvent, HotUpdateKind, HotUpdatePlan } from "./types.js";

/**
 * Deciding what changed — the host-neutral half of a hot update.
 *
 * Everything in this file is a plain `@zintljs/compiler` call taking and
 * returning strings. That was already true of this logic before it moved here;
 * proposal 028 §6.1 read it and said so. What it was missing was a file of its
 * own, so that a second host could reach it without also reaching Vite's module
 * graph.
 *
 * The same shape 026 §4.1 found once already, in `resolveIdHook`: _"the compiler
 * already owns a graph that knows the answer... the bundler facet only applies
 * the id rewrites the plan dictates."_
 */

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|html|vue|svelte)$/;

/**
 * What kind of update this file is, or `null` if Zintl has no interest in it.
 *
 * Extension-based, deliberately: this runs before the compiler is asked
 * anything, on every file a watcher reports, and the cheap test is what keeps an
 * unrelated `.css` edit from touching the graph at all.
 */
export function classifyFile(file: string): HotUpdateKind | null {
  if (SOURCE_EXTENSIONS.test(file)) return "source";
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".md") || file.endsWith(".txt")) return "asset";
  return null;
}

/**
 * Everything a host must know before it can decide what to run again.
 *
 * Returns `null` when the event is not one Zintl acts on — a file it is itself
 * writing, or a file type it does not extract from. Both cases record a trace
 * entry, because "the hook ran and declined" and "the hook never ran" are
 * different diagnoses and `describeStall()` has to be able to tell them apart.
 */
export async function computeHotUpdatePlan(
  ctx: Context,
  event: HotUpdateEvent,
): Promise<HotUpdatePlan | null> {
  const { file, seq, kind } = event;

  /**
   * A write Zintl is performing is not a user edit.
   *
   * Without this, `flush()` writing a scaffolded catalog re-enters as an update
   * and the compiler chases its own tail.
   */
  if (ctx.compiler.isWritingFile(file)) {
    ctx.hmrTrace.push({ ts: Date.now(), kind: "skip-writing", file });
    return null;
  }

  ctx.hmrTrace.push({
    ts: Date.now(),
    kind: "enter",
    file,
    seq,
    modulesLength: event.modulesLength,
    environment: event.environment,
  });

  const invalidatedBoundaries: string[] = [];
  let invalidateAllManagers = false;

  if (kind === "json" || kind === "asset") {
    if (kind === "asset") {
      await (ctx.compiler.assets as AssetManager).registerAsset(file);
    }
    const inv = await ctx.compiler.invalidateForUpdate(file, seq, true);
    for (const b of inv) invalidatedBoundaries.push(b);

    /**
     * A catalog the graph could not attribute to a boundary — a hand-edited
     * translation for a key the current extraction no longer produces, most
     * often. Re-evaluating every manager is broad, but bounded and correct;
     * doing nothing would silently drop the edit.
     */
    if (inv.length === 0 && kind === "json") invalidateAllManagers = true;
  } else {
    const inv = await ctx.compiler.invalidateForUpdate(file, seq, false, event.content);
    for (const b of inv) invalidatedBoundaries.push(b);
  }

  /**
   * Fire-and-forget on purpose. The flush writes catalogs to disk, which the
   * browser does not wait on — the update it *does* wait on is the re-evaluated
   * content module, which is served from the compiler's memory. Awaiting here
   * would put a disk write on the hot path for no observable gain.
   */
  ctx.compiler
    .flush()
    .catch((e) =>
      ctx.compiler._logger.withPrefix("HMR").error(`Background flush failed: ${String(e)}`),
    );

  const boundaryIds = new Set(invalidatedBoundaries);
  if (kind === "source") boundaryIds.add(ctx.compiler.getNormalizedId(file));

  const boundaries: BoundaryUpdate[] = [];
  let fullReload = false;

  for (const boundaryId of boundaryIds) {
    const entryFilePaths: string[] = [];

    /**
     * `b_assets` is synthetic: it owns no file, so there is nothing to resolve
     * it to. An asset edit reaches the app through whichever entries render it,
     * so the entries are what the host must re-evaluate.
     */
    if (boundaryId === "b_assets" && ctx.compiler.graph.boundaryGraph) {
      for (const [, node] of ctx.compiler.graph.boundaryGraph.nodes.entries()) {
        if (node.mode === "entry" && node.filePath && node.filePath !== "assets") {
          entryFilePaths.push(node.filePath);
        }
      }
    }

    /**
     * Boundary identity is content-based (`b_<hash>`), and the graph is keyed by
     * the raw id — so a safe-id lookup misses and has to be resolved by scanning.
     * The scan compares through `io.getSafeBoundaryId`, which is the compiler's
     * own answer rather than a string guess.
     */
    let node = ctx.compiler.graph.boundaryGraph?.nodes.get(boundaryId);
    if (!node) {
      for (const [nid, n] of ctx.compiler.graph.boundaryGraph?.nodes.entries() || []) {
        if (ctx.compiler.io.getSafeBoundaryId(nid) === boundaryId) {
          node = n;
          break;
        }
      }
    }

    const rawFileId =
      node?.filePath || (boundaryId.includes(":") ? boundaryId.split(":")[0] : boundaryId);
    const hasFile = Boolean(rawFileId) && rawFileId !== "assets" && !rawFileId.includes("\0");
    const fileId = hasFile ? rawFileId : undefined;

    boundaries.push({
      boundaryId,
      chunkIds: ctx.compiler.getAffectedChunks(boundaryId),
      fileId,
      absFileId: fileId
        ? isAbsolute(fileId)
          ? fileId
          : join(ctx.compiler.rootDir, fileId)
        : undefined,
      entryFilePaths,
    });

    /** The document itself changed; there is no patching a `<title>` in place. */
    if (boundaryId.endsWith(".html")) fullReload = true;

    /**
     * A boundary that exists only on the server has no client module to replace,
     * so the only way its update becomes visible is to fetch the page again.
     */
    const isSsr = ctx.compiler.ssrBoundaries?.has(boundaryId);
    const isClient = ctx.compiler.clientBoundaries?.has(boundaryId);
    if (isSsr && !isClient) fullReload = true;

    /**
     * Nothing in the page can act on the new catalog, so the server has to say so.
     *
     * When the host declines to make generated catalogs self-accepting — no
     * framework subscribed to the store, and an applier that does not re-run the
     * entry — the update reaches the browser and is simply lost. A fetched
     * catalog arrives through a dynamic import, which is a chunk boundary with
     * no static parent, so *declining* does not bubble to a reload the way it
     * does inside a statically imported entry. The measured result was the worst
     * kind of silent: `addCatalogs` applied, the store holding the new
     * translation, and the heading still showing the text painted before the
     * edit (ledger L-064).
     *
     * So the reload is issued deliberately rather than hoped for. Slower than a
     * hot update and correct, which is the same trade L-035 made for source
     * files on this host.
     */
    if (!ctx.compiler.generatedModulesSelfAccept) fullReload = true;
  }

  return { event, boundaries, fullReload, invalidateAllManagers };
}
