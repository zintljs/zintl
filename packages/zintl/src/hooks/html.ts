/**
 * @module hooks/html
 *
 * The HTML seam for hosts that are not Vite.
 *
 * Zintl projects `<html lang>`/`dir`, `<title>`, `<meta description>` and the
 * bootstrap script into a document through `compiler.transformHtml()`. That
 * function is host-neutral and always was; what was not neutral is the only
 * thing that ever called it — Vite's `transformIndexHtml`, which lives in the
 * plugin's `vite: {}` block and which unplugin drops on every other target.
 *
 * Rsbuild's `api.modifyHTML` has the same shape, so this is wiring rather than a
 * second implementation. Two things had to be worked out first, and both were
 * where proposal 026's attempt at this came apart:
 *
 * 1. **Identity.** Rsbuild hands the hook an *output* filename (`index.html`,
 *    relative to `dist`) where Vite hands an absolute *source* path. Passing the
 *    former straight through produced a blank page, because the projection
 *    re-reads the source from disk on a cache miss and found nothing.
 * 2. **The boundary link.** An Rsbuild template names no scripts, so nothing
 *    connected the document to a trust anchor. That is `htmlEntries`, declared
 *    from the same config below (ledger L-021).
 */
import type Context from "../context.js";

/**
 * The sliver of Rsbuild's API this file uses, declared structurally.
 *
 * `zintljs` does not depend on `@rsbuild/core` — see `plugin.ts` for why.
 * Matches `@rsbuild/core@2.1.10`.
 */
export interface RsbuildHtmlApi {
  getNormalizedConfig?: () => RsbuildNormalizedConfig | undefined;
  onBeforeEnvironmentCompile?: (fn: () => void) => void;
  modifyHTML?: (fn: (html: string, ctx: RsbuildHtmlContext) => Promise<string> | string) => void;
}

interface RsbuildNormalizedConfig {
  source?: { entry?: Record<string, unknown> };
  html?: { template?: unknown };
  output?: { target?: string };
}

interface RsbuildHtmlContext {
  /** Output name, relative to the dist directory — **not** a source path. */
  filename?: string;
  compiler?: { options?: { context?: string } };
  environment?: {
    htmlPaths?: Record<string, string>;
    config?: RsbuildNormalizedConfig;
  };
}

/** Strip a leading `./` and normalize separators, so ids match the graph's. */
function toId(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Resolve `html.template`, which may be a plain string or a per-entry function.
 *
 * Returns `undefined` when Rsbuild is using its own built-in template, which is
 * a real case and not an error: there is no file in the project to project into,
 * so there is nothing for Zintl to do.
 */
function resolveTemplate(config: RsbuildNormalizedConfig | undefined, entryName: string) {
  const template = config?.html?.template;
  if (typeof template === "string") return template;
  if (typeof template === "function") {
    try {
      const resolved = (template as (ctx: { entryName: string }) => unknown)({ entryName });
      return typeof resolved === "string" ? resolved : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Every entry name whose emitted document is `filename`. */
function entriesFor(htmlPaths: Record<string, string> | undefined, filename: string): string[] {
  if (!htmlPaths) return [];
  return Object.keys(htmlPaths).filter((name) => toId(htmlPaths[name]) === toId(filename));
}

/**
 * Declare which source scripts each HTML document loads.
 *
 * Registered on `onBeforeEnvironmentCompile` rather than `onBeforeBuild`,
 * because **`onBeforeBuild` does not fire for `rsbuild dev`** — measured, not
 * assumed — while this one fires on both paths and, on both, before
 * `buildStart` and therefore before discovery. That ordering is the whole
 * requirement: the association has to exist before the graph is built, or the
 * document is analysed without it and no catalog is ever scaffolded.
 */
export function declareHtmlEntriesHook(ctx: Context, api: RsbuildHtmlApi): void {
  api.onBeforeEnvironmentCompile?.(() => {
    const config = api.getNormalizedConfig?.();
    const entry = config?.source?.entry;
    if (!entry) return;

    for (const [entryName, value] of Object.entries(entry)) {
      const template = resolveTemplate(config, entryName);
      if (!template) continue;

      const scripts = (Array.isArray(value) ? value : [value]).filter(
        (v): v is string => typeof v === "string",
      );
      if (!scripts.length) continue;

      const htmlId = toId(template);
      const existing = ctx.htmlEntries[htmlId] ?? [];
      ctx.htmlEntries[htmlId] = [
        ...existing,
        ...scripts.map(toId).filter((s) => !existing.includes(s)),
      ];
    }
  });
}

/**
 * Project a document on its way out, the way `transformIndexHtml` does on Vite.
 *
 * `preloads` is deliberately `{}`. It only drives `<link rel="modulepreload">`
 * injection, and computing it here would mean walking `Rspack.Compilation`'s
 * chunk graph — a second implementation of the mapping the Vite hook derives
 * from Rollup's `bundle`, which is the shape ledger L-002a warns about. The
 * empty object is a case the projection already handles on every Vite dev page,
 * so it is exercised rather than novel.
 */
export function modifyHtmlHook(ctx: Context) {
  return async function (html: string, hostCtx: RsbuildHtmlContext): Promise<string> {
    if (!ctx.compiler) return html;

    const logger = ctx.compiler._logger.withPrefix("Rsbuild");
    const config = hostCtx.environment?.config;

    /**
     * SSR builds get their own environment with a `node` target. It is out of
     * scope here, so skipping is correct — but it is skipped explicitly rather
     * than by accident, because "the projection quietly did nothing" is the
     * failure mode this whole seam exists to stop being possible.
     */
    const target = config?.output?.target;
    if (target && target !== "web") {
      logger.debug(`Skipping HTML projection for non-web target: ${target}`);
      return html;
    }

    const filename = hostCtx.filename;
    if (!filename) {
      logger.warn("HTML projection skipped: the host supplied no filename for this document.");
      return html;
    }

    /**
     * Invert output → source. `filename` is what Rsbuild emitted; the projection
     * needs the template the user wrote, because it re-reads that file to
     * refresh metadata and because sink offsets were computed against it.
     *
     * Absence is loud. A document Zintl cannot place is one whose translations
     * would silently never appear, and Deliverable 2 §2.3's rule — host-supplied
     * values need a loud absence, not a plausible default — was written after
     * three separate bugs of exactly that shape.
     */
    const candidates = entriesFor(hostCtx.environment?.htmlPaths, filename);
    const entryName = candidates[0];
    const template = entryName ? resolveTemplate(config, entryName) : undefined;

    if (!template) {
      logger.warn(
        `HTML projection skipped for "${filename}": no source template resolved for it. ` +
          `Translations for <title>, <meta description> and <html dir> will not appear on ` +
          `this page. This is expected when Rsbuild is using its own built-in template.`,
      );
      return html;
    }

    if (candidates.length > 1) {
      logger.warn(
        `"${filename}" is emitted by ${candidates.length} entries (${candidates.join(", ")}); ` +
          `projecting as "${entryName}".`,
      );
    }

    return await ctx.compiler.transformHtml(html, toId(template), {});
  };
}
