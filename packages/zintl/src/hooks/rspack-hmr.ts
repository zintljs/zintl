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
 * Registered from the plugin's `rspack(compiler)` escape hatch, which unplugin
 * calls under raw Rspack *and* under Rsbuild — `toRsbuildPlugin` pushes the raw
 * plugin into `modifyRspackConfig`, so `applyRspackPlugins` runs it either way.
 * One registration covers both hosts, exactly as `rspackFacet` does.
 *
 * **`watchRun`, not unplugin's `watchChange`.** unplugin exposes `watchChange`
 * on this host by tapping `compiler.hooks.make`, which would work, but `watchRun`
 * fires *earlier* — before module building starts — and hands the whole changed
 * batch rather than one file at a time. Both matter. The manifest has to be
 * re-extracted before the transform loader runs on any module, or the very
 * compilation this event triggered builds against stale strings; and the batch is
 * what makes the sequence below meaningful.
 */
export function registerRspackHotUpdate(ctx: Context, compiler: RspackCompilerLike): void {
  compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, async (c: RspackCompilerLike) => {
    /**
     * The compiler is built in `buildStart`, which unplugin taps to
     * `compiler.hooks.make` — after this hook. So on the very first watch run
     * there is nothing here yet, which is correct: the first run is the initial
     * build and reports no modified files anyway.
     */
    if (!ctx.compiler || !ctx.compiler.isDev) return;

    if (!ctx.updateApplier) {
      registerUpdateApplier(ctx, new RspackUpdateApplier(ctx));
      if (!ctx.updateApplier) return;
    }

    for (const file of c.removedFiles ?? []) {
      await ctx.compiler.removeFile(file).catch((err: unknown) => {
        ctx.compiler._logger
          .withPrefix("HMR")
          .error(`Failed to forget deleted file ${file}: ${String(err)}`);
      });
    }

    const modified = c.modifiedFiles;
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
      const kind = classifyFile(file);
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
  });
}
