/**
 * test-context.ts
 *
 * Context for unit / transform tests that write their own source files.
 * Use this when you want full control over every input file in the test.
 *
 * Usage:
 *
 *   const ctx = await createZintlContext({ sourceLocale: "en", locales: ["en", "ar"] });
 *   const code = await ctx.transform("src/App.tsx", `...`);
 *   const output = await ctx.build();
 *   expect(output["index.js"]).toMatchSnapshot();
 *   await ctx.cleanup();
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { build as viteBuild, mergeConfig, type InlineConfig, type Rollup } from "vite";
import zintl from "../../vite.js";
import {
  type TestContext,
  type BuildOutput,
  collectOutput,
  createZintlMatchers,
  BASE_TEST_OVERRIDES,
} from "./utils.ts";
import { createTestDir } from "./fs.ts";

// ---------------------------------------------------------------------------

/**
 * The harness's plugin options, defined once.
 *
 * These deliberately differ from production defaults (`prune` and
 * `verifyIntegrity` off, two locales) because tests assert on catalog files
 * without wanting pruning or integrity checks. That is legitimate test config —
 * the problem was that the same block was written out twice, making it a fourth
 * place a Zintl default appeared to live.
 */
function testPluginOptions(options: any = {}) {
  return {
    sourceLocale: "en",
    locales: ["en", "ar"],
    prune: false,
    verifyIntegrity: false,
    ...options,
  };
}

export async function createZintlContext(options: any = {}): Promise<TestContext> {
  /**
   * One temp-dir policy, not two.
   *
   * This used to keep its own `.tmp` beside the helper, with its own naming and
   * no clearing — so the project had two independent scratch trees, both
   * gitignored, both growing forever. Sharing `createTestDir` means the
   * per-worker base is cleared once per run for this too, and a context whose
   * `cleanup` is never called costs one run rather than every run.
   */
  const root = await createTestDir("zintl-test-");

  /**
   * Give the synthesized project a `package.json`, so framework detection has
   * something to read.
   *
   * Detection looks at plugin names and declared dependencies, and a test
   * project has neither unless it says so. That used to be invisible because
   * detection guessed React whenever it found nothing — so a `.tsx` fixture got
   * React facets it never asked for. With the guess removed (ledger L-034), a
   * test that means "a React project" has to declare React, exactly as a real
   * one would.
   */
  const { dependencies, ...pluginOptions } = options;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "zintl-test-project", private: true, dependencies: dependencies ?? {} }),
  );

  const rawPlugin = zintl(testPluginOptions(pluginOptions));

  /**
   * The plugin-context methods a real host always supplies on `this`.
   *
   * Rollup, Vite and unplugin's Rspack loader all hand `load`/`transform` a
   * context object; calling the hook straight off the plugin gives it `this ===
   * the plugin`, which has none of them. That went unnoticed while
   * `generateVirtualModule` returned an empty `watchedFiles` for content and
   * manager modules — the `addWatchFile` loop simply never ran. It runs now
   * (proposal 029 uses those declared dependencies as Rspack's whole
   * invalidation mechanism), so the harness has to model the context rather than
   * rely on it being unreachable.
   *
   * Tests that pass their own context via `.call(ctx, …)` keep it: the override
   * below only fills in for a `this` that is plainly not a plugin context.
   */
  const defaultPluginContext = {
    addWatchFile: () => {},
    emitFile: () => "test-ref-id",
    resolve: async () => null,
  };

  const withPluginContext = (hook: any) =>
    function (this: any, ...args: any[]) {
      const self = this && typeof this.addWatchFile === "function" ? this : defaultPluginContext;
      return hook.apply(self, args);
    };

  const getPluginHooks = (p: any) => {
    const list = Array.isArray(p) ? p : [p];
    const main = list.find((x) => x.name === "zintl") || list[0];
    const pre = list.find((x) => x.name === "zintl-pre") || list[0];
    return {
      config: main.vite?.config,
      configResolved: main.vite?.configResolved,
      configureServer: main.vite?.configureServer,
      transformIndexHtml: main.vite?.transformIndexHtml || pre.vite?.transformIndexHtml,
      handleHotUpdate: main.vite?.handleHotUpdate,
      hotUpdate: main.vite?.hotUpdate,
      buildStart: main.buildStart,
      buildEnd: main.buildEnd,
      resolveId: withPluginContext(main.resolveId),
      load: withPluginContext(main.load),
      transform: withPluginContext(main.transform),
      get __compiler() {
        return (globalThis as any).__zintl_active_contexts?.slice(-1)[0]?.compiler;
      },
    };
  };

  const plugin = getPluginHooks(rawPlugin);

  const isDev = !!options.isDev;

  if (plugin.configResolved) {
    await (plugin.configResolved as any)({
      root,
      command: isDev ? "serve" : "build",
    });
  }

  // -------------------------------------------------------------------------
  // setupFile
  // -------------------------------------------------------------------------
  const setupFile = async (path: string, content: string): Promise<string> => {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    return fullPath;
  };

  // -------------------------------------------------------------------------
  // transform
  // -------------------------------------------------------------------------
  const transform = async (path: string, content: string): Promise<string> => {
    await setupFile(path, content);
    if (!plugin.transform) return content.trim();
    const result = await (plugin.transform as any)(content, join(root, path));
    if (!result) return content.trim();
    return result.code.trim().replace(/\r\n/g, "\n");
  };

  // -------------------------------------------------------------------------
  // project
  // -------------------------------------------------------------------------
  const project = async (files: Record<string, string> = {}): Promise<Record<string, string>> => {
    // 1. Write all files
    const paths: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      paths[path] = await setupFile(path, content);
    }

    if (plugin.buildStart) {
      await (plugin.buildStart as any)();
    }

    // 2. Warmup — extraction pass
    for (const [path, content] of Object.entries(files)) {
      if (plugin.transform) {
        await (plugin.transform as any)(content, paths[path]);
      }
    }

    // 3. Flush catalogs for baking
    if (plugin.buildEnd) {
      await (plugin.buildEnd as any)();
    }

    // 4. Final transform for assertions
    const results: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      const result = plugin.transform
        ? await (plugin.transform as any)(content, paths[path])
        : null;
      results[path] = result ? result.code.trim().replace(/\r\n/g, "\n") : content.trim();
    }

    return results;
  };

  // -------------------------------------------------------------------------
  // build — fully in-process, no subprocess, no disk writes
  // -------------------------------------------------------------------------
  const build = async (): Promise<BuildOutput> => {
    const config: InlineConfig = mergeConfig(
      {
        root,
        logLevel: "silent",
        plugins: [zintl(testPluginOptions(options))],
      },
      { build: BASE_TEST_OVERRIDES },
    );

    const result = await viteBuild(config);
    return collectOutput(result as Rollup.RollupOutput | Rollup.RollupOutput[]);
  };

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------
  /**
   * Remove this context's project directory.
   *
   * This was an empty function. Every test dutifully awaited it in `afterEach`
   * or `afterAll`, and each run left its directory behind — 5,308 of them, 53 MB,
   * accumulated silently because `.tmp` is gitignored. A cleanup contract that
   * callers honour and the implementation ignores is worse than no contract:
   * it makes the leak invisible to exactly the people looking for it.
   *
   * Failures are swallowed. A directory that cannot be removed — held open on
   * Windows, already gone — must never fail the test that created it.
   */
  const cleanup = async (): Promise<void> => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Best effort; the next run reuses the same base directory anyway.
    }
  };

  return {
    root,
    plugin,
    setupFile,
    transform,
    project,
    build,
    cleanup,
    filterForSnapshots: (results: Record<string, string>) => results,
    filterDistForSnapshots: (results: Record<string, string>) => results,
    matchers: createZintlMatchers(plugin),
  };
}
