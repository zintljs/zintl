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

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild, mergeConfig, type InlineConfig, type Rollup } from "vite";
import zintl from "../../vite.js";
import {
  type TestContext,
  type BuildOutput,
  collectOutput,
  createZintlMatchers,
  BASE_TEST_OVERRIDES,
  sha1,
} from "./utils.ts";

// ---------------------------------------------------------------------------

export async function createZintlContext(options: any = {}): Promise<TestContext> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tmpBase = join(__dirname, ".tmp");
  await mkdir(tmpBase, { recursive: true });

  // Unique dir name to prevent parallel workers/tests from colliding.
  const root = join(
    tmpBase,
    `zintl-test-${sha1(JSON.stringify(options))}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(root, { recursive: true });

  const plugin = zintl({
    sourceLocale: "en",
    locales: ["en", "ar"],
    prune: false,
    verifyIntegrity: false,
    ...options,
  });

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
        plugins: [
          zintl({
            sourceLocale: "en",
            locales: ["en", "ar"],
            prune: false,
            verifyIntegrity: false,
            ...options,
          }),
        ],
        resolve: {
          alias: {
            "zintl/internal": fileURLToPath(
              new URL("../../../../runtime/src/internal.ts", import.meta.url),
            ),
            zintl: fileURLToPath(new URL("../../../../runtime/src/index.ts", import.meta.url)),
          },
        },
      },
      { build: BASE_TEST_OVERRIDES },
    );

    const result = await viteBuild(config);
    return collectOutput(result as Rollup.RollupOutput | Rollup.RollupOutput[]);
  };

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------
  const cleanup = async (): Promise<void> => {};

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
