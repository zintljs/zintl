import type Context from "../context.js";
import { PLUGIN_NAME } from "../constants.js";
import { registerUpdateApplier } from "../hmr/index.js";
import { classifyFile, computeHotUpdatePlan } from "../hmr/plan.js";
import { RspackUpdateApplier } from "../hmr/rspack.js";

/**
 * The sliver of Rspack's compiler API this uses.
 *
 * Declared structurally rather than imported, for the same reason
 * `RsbuildSetupApi` in `plugin.ts` is: `zintljs` does not take a hard dependency
 * on Rspack. Matches `@rspack/core@2.1.8` — `Compiler.hooks.watchRun` is an
 * `AsyncSeriesHook<[Compiler]>`, `modifiedFiles`/`removedFiles` are
 * `ReadonlySet<string> | undefined`, and `Watching.startTime` is `number |
 * undefined`.
 */
interface RspackCompilerLike {
  hooks: { watchRun: { tapPromise(name: string, fn: (c: any) => Promise<void>): void } };
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  watching?: { startTime?: number };
  inputFileSystem?: {
    readFile(path: string, cb: (err: unknown, data?: Buffer | string) => void): void;
  } | null;
}

/**
 * Read a file the way *this compilation* will read it.
 *
 * The Rspack analogue of Vite's `read()`, and it is load-bearing for the same
 * reason ZDB §7a gives: reading the file independently is how a later write
 * becomes a no-op. `compiler.inputFileSystem` is the cache the compilation is
 * about to build from — purged per watch run — so a read through it is a read of
 * the content this event describes, not of whatever is on disk by the time the
 * read lands.
 *
 * Falls back to `undefined`, which tells the compiler to read the file itself.
 * That is the weaker guarantee, and it is what a host with no such filesystem
 * would get.
 */
function readThroughCompilation(
  compiler: RspackCompilerLike,
  file: string,
): Promise<string | undefined> {
  const fs = compiler.inputFileSystem;
  if (!fs?.readFile) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    fs.readFile(file, (err, data) => {
      if (err || data === undefined) return resolve(undefined);
      resolve(typeof data === "string" ? data : data.toString("utf-8"));
    });
  });
}

/**
 * Rspack's contribution to the hot-update seam (proposal 029).
 *
 * Registered from the plugin's `rsbuild` block via `api.modifyRspackConfig`.
 * **Not** from unplugin's `rspack(compiler)` escape hatch, which never fires
 * under Rsbuild: unplugin gates it on `meta.framework === "rspack"` and its
 * Rsbuild target sets `"rsbuild"`, then hands that same meta to the Rspack
 * plugin it injects. That hook is kept for a future raw-Rspack entry point, and
 * registration is idempotent per compiler so both routes are safe (L-041).
 *
 * **`watchRun`, not unplugin's `watchChange`.** unplugin exposes `watchChange`
 * on this host by tapping `compiler.hooks.make`, which would work, but `watchRun`
 * fires *earlier* — before module building starts — and hands the whole changed
 * batch rather than one file at a time. Both matter. The manifest has to be
 * re-extracted before the transform loader runs on any module, or the very
 * compilation this event triggered builds against stale strings; and the batch is
 * what makes the sequence below meaningful.
 */
/**
 * Compilers already tapped, so the two routes here cannot double-tap one.
 *
 * There are two by design: raw Rspack through unplugin's `rspack` escape hatch,
 * Rsbuild through `api.modifyRspackConfig`. Only one fires for any given host
 * today — but "only one fires" is exactly the class of claim ledger L-041 was
 * made of, so this does not rely on it.
 */
const tapped = new WeakSet<object>();

export function registerRspackHotUpdate(ctx: Context, compiler: RspackCompilerLike): void {
  if (tapped.has(compiler)) return;
  tapped.add(compiler);

  /**
   * Recorded at registration, not just per event.
   *
   * An empty trace used to be unreadable: "the tap never ran" and "the tap ran
   * and declined" looked identical, and the first of those was true for a year
   * without anyone noticing (ledger L-041). With this entry, an empty trace on
   * an Rspack host means exactly one thing — this function was never called.
   */
  ctx.hmrTrace.push({
    ts: Date.now(),
    kind: "watch",
    file: "(registration)",
    reason: "watchRun tap registered",
  });
  compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, async (c: RspackCompilerLike) => {
    /**
     * The compiler is built in `buildStart`, which unplugin taps to
     * `compiler.hooks.make` — after this hook. So on the very first watch run
     * there is nothing here yet, which is correct: the first run is the initial
     * build and reports no modified files anyway.
     */
    if (!ctx.compiler || !ctx.compiler.isDev) {
      ctx.hmrTrace?.push({
        ts: Date.now(),
        kind: "watch",
        file: "(none)",
        reason: !ctx.compiler ? "no compiler yet" : "compiler is not in dev mode",
      });
      return;
    }

    if (!ctx.updateApplier) {
      registerUpdateApplier(ctx, new RspackUpdateApplier(ctx));
      if (!ctx.updateApplier) return;
    }

    /**
     * Removals are traced as well as acted on, because the trace could not
     * previously tell "the host reported no deletion" from "the deletion was
     * reported and dropped".
     *
     * That is the same blindness ledger L-041 recorded for the tap itself —
     * `(registration)` exists so an empty trace means the hook never ran — one
     * event kind further in. `chaos-boundary` fails here with "the host's
     * watcher never reported the unlink", and until this line that claim was an
     * inference from the *absence* of a consequence rather than an observation.
     */
    const removed = c.removedFiles;
    if (removed?.size) {
      ctx.hmrTrace.push({
        ts: Date.now(),
        kind: "watch",
        file: "(batch)",
        modulesLength: removed.size,
        reason: `${removed.size} removed: ${[...removed].join(", ")}`,
      });
    }
    for (const file of removed ?? []) {
      await ctx.compiler.removeFile(file).catch((err: unknown) => {
        ctx.compiler._logger
          .withPrefix("HMR")
          .error(`Failed to forget deleted file ${file}: ${String(err)}`);
      });
    }

    const modified = c.modifiedFiles;
    ctx.hmrTrace.push({
      ts: Date.now(),
      kind: "watch",
      file: "(batch)",
      modulesLength: modified?.size ?? 0,
      reason: modified === undefined ? "modifiedFiles undefined" : `${modified.size} modified`,
    });
    if (!modified || modified.size === 0) return;

    /**
     * The host's clock, not one of Zintl's.
     *
     * `Watching.startTime` is set by Rspack per watch cycle. It is monotonic
     * because time is, and non-repeating in practice because compilations are
     * serialised and take milliseconds — which is the pair ZDB §7a requires, and
     * the reason that section says to take the bundler's clock rather than mint
     * one: a second clock that can disagree with the host's is worse than none.
     *
     * Every file in this batch shares it, and that is correct rather than
     * sloppy: they are one event. `invalidateForUpdate`'s custody (Axiom D3) keys
     * on subject *and* sequence, and each file is its own subject, so sharing the
     * number joins nothing that should not be joined.
     */
    const seq = c.watching?.startTime ?? Date.now();

    for (const file of modified) {
      const kind = classifyFile(ctx, file);
      if (!kind) continue;

      /**
       * A failure here must never reach the host.
       *
       * This runs inside `watchRun.tapPromise`, so a rejection propagates into
       * Rspack's own compilation — and the most ordinary input in dev is the
       * one most likely to produce it: a file saved mid-keystroke, which the
       * extractor cannot parse. Letting that reject turns "your syntax error"
       * into "the watcher stopped", and the recovery edit never gets compiled
       * because there is no longer a pipeline to compile it. Zintl declining to
       * update is the correct outcome for an unparseable file; the host still
       * has its own error to report.
       */
      try {
        const content = kind === "source" ? await readThroughCompilation(c, file) : undefined;

        const plan = await computeHotUpdatePlan(ctx, { file, seq, kind, content });
        if (!plan) continue;

        const result = await ctx.updateApplier.apply(plan);
        ctx.hmrTrace.push({
          ts: Date.now(),
          kind: "return",
          file,
          invalidatedCount: result.count,
          passthrough: false,
        });
      } catch (err) {
        ctx.compiler._logger
          .withPrefix("HMR")
          .error(`Update failed for ${file}, leaving it to the next edit: ${String(err)}`);
      }
    }

    /**
     * Wait for the catalogs to be on disk before letting this compilation run.
     *
     * `computeHotUpdatePlan` starts the flush and deliberately does not await it,
     * and its reasoning is exactly right *for Vite*: there the browser's update
     * is the re-evaluated content module, served from the compiler's memory, so a
     * disk write is not on the hot path.
     *
     * On Rspack it is the hot path. The generated content and manager modules
     * declare the catalog files as dependencies (proposal 029 §3) and Rspack
     * builds them by **reading those files**. Leaving the flush in flight means
     * the compilation this hook precedes can read the previous catalog — and the
     * whole reason `watchRun` was chosen over `watchChange` is that it fires
     * before module building, so this is the one place the ordering can be
     * guaranteed rather than hoped for.
     *
     * Measured: without this, `syntax-recovery` on `rsbuild-vanilla-basic` failed 9 runs in
     * 10, and the diagnosis showed the server sending `hash`+`ok` correctly while
     * the reloaded page came back missing the recovered key — a bundle built from
     * a catalog the flush had not yet written.
     *
     * Awaiting is affordable precisely because it is not per-update: one flush
     * per watch cycle, coalesced across the batch, before a compilation that is
     * about to do considerably more work.
     */
    await ctx.compiler
      .flush()
      .catch((err: unknown) =>
        ctx.compiler._logger
          .withPrefix("HMR")
          .error(`Flush before compilation failed: ${String(err)}`),
      );
  });
}
