/**
 * examples-harness.ts
 *
 * Single context for all example-based tests — transform assertions,
 * snapshot tests, and full dist builds — all using the example's real
 * vite.config.ts as the source of truth.
 *
 * Root layout:
 *
 *   <monorepo>/examples/website/         ← real source, never modified
 *   <this-file>/../.tmp/website-<hash>/  ← temp overlay (setupFile writes here)
 *
 * Modes:
 *   mode: "development"  →  project() drives transforms with dev compiler
 *   mode: "production"   →  project() drives transforms with prod compiler (default)
 *   build()              →  always runs the full Vite pipeline in production mode,
 *                           uses its own isolated plugin instance — never shares
 *                           state with the project() compiler
 *
 * Usage:
 *
 *   // Dev transform assertions
 *   const ctx = await createExampleContext("website", { mode: "development" });
 *   const results = await ctx.project(exampleFiles);
 *   ctx.matchers.toRegisterT(results["src/main.ts"], "Hello", "src/main");
 *
 *   // Prod transform assertions
 *   const ctx = await createExampleContext("website", { mode: "production" });
 *   const results = await ctx.project(exampleFiles);
 *   ctx.matchers.toHandshake(results["src/main.ts"], "src/main");
 *
 *   // Full dist build snapshot
 *   const ctx = await createExampleContext("website");
 *   const dist = await ctx.build();
 *   expect(dist["index.html"]).toMatchSnapshot();
 *
 *   // Override a Vite option without touching the fixture
 *   const ctx = await createExampleContext("basic", {
 *     overrides: { build: { target: "es2022" } },
 *   });
 */

import { writeFile, readFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  build as viteBuild,
  loadConfigFromFile,
  mergeConfig,
  type ConfigEnv,
  type InlineConfig,
  type Rollup,
} from "vite";
import { zintl } from "../../index.ts";
import {
  type TestContext,
  type BuildOutput,
  collectOutput,
  createZintlMatchers,
  buildTestOverrides,
  TEST_DEFINES,
  findMonorepoRoot,
  sha1,
} from "./utils.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = findMonorepoRoot(__dirname);
const EXAMPLES_ROOT = join(MONOREPO_ROOT, "examples");

// ---------------------------------------------------------------------------
// Build cache — keyed by (name + serialised overrides), per worker process.
// project() state is never cached — each context gets a fresh compiler.
// ---------------------------------------------------------------------------

const buildCache = new Map<string, Promise<BuildOutput>>();

// function clearExampleBuildCache(): void {
//   buildCache.clear();
// }

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface ExampleContextOptions {
  /**
   * Controls which mode the example's vite.config.ts is loaded in, and which
   * mode the plugin compiler runs in for project() / transform() calls.
   *
   * - "development"  →  identity keys, dev compiler (mirrors `vp dev`)
   * - "production"   →  baked keys, prod compiler (mirrors `vp build`) [default]
   *
   * build() always runs in production mode regardless of this setting —
   * it is a full Vite production build.
   */
  mode?: "development" | "production";

  /**
   * Extra Vite config merged on top of the example's own vite.config.ts,
   * below the test-mode overrides (write:false, stable names, etc.).
   *
   * Only applied during build() — not during project() / transform().
   */
  overrides?: InlineConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createExampleContext(
  name: string,
  { mode = "production", overrides = {} }: ExampleContextOptions = {},
): Promise<TestContext> {
  const exampleRoot = join(EXAMPLES_ROOT, name);

  // Temp overlay — isolated write space, never touches the real example
  const tmpBase = join(__dirname, ".tmp");
  await mkdir(tmpBase, { recursive: true });

  const overlayRoot = join(
    tmpBase,
    `example-${name}-${sha1(mode + JSON.stringify(overrides))}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(overlayRoot, { recursive: true });

  // -------------------------------------------------------------------------
  // Load the example's vite.config.ts in the requested mode.
  // This gives us the real plugin options the example author configured.
  // -------------------------------------------------------------------------
  const configEnv: ConfigEnv = {
    command: mode === "development" ? "serve" : "build",
    mode,
  };
  const configLoaded = await loadConfigFromFile(configEnv, undefined, exampleRoot);
  const rawPlugins = configLoaded?.config.plugins || [];
  const exampleZintl = rawPlugins.find((p: any) => p?.name === "zintl");
  const exampleOptions = (exampleZintl as any)?.__options || {};

  const examplePlugins = rawPlugins.filter((p: any) => p && p.name !== "zintl") as any[];

  const tempOutputDir = join(overlayRoot, ".tmp", "locales");
  await mkdir(tempOutputDir, { recursive: true });

  const tempMetadataPath = join(overlayRoot, "node_modules", ".zintl");
  await mkdir(tempMetadataPath, { recursive: true });

  const realOutputDir =
    exampleOptions.outputDir ?? (existsSync(join(exampleRoot, "zintl")) ? "zintl" : "src/locales");
  const realLocalesPath = isAbsolute(realOutputDir)
    ? realOutputDir
    : join(exampleRoot, realOutputDir);

  const copyDir = async (src: string, dest: string) => {
    try {
      if (!existsSync(src)) return;
      const entries = await readdir(src, { withFileTypes: true });
      await mkdir(dest, { recursive: true });
      for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await writeFile(destPath, await readFile(srcPath));
        }
      }
    } catch (e) {
      console.warn(`[Harness] Failed to copy ${src} to ${dest}:`, e);
    }
  };

  await copyDir(realLocalesPath, tempOutputDir);

  const realMetadataPath = join(exampleRoot, "node_modules", ".zintl");
  await copyDir(realMetadataPath, tempMetadataPath);

  // -------------------------------------------------------------------------
  // Project plugin — drives transform() and project().
  // Isolated from the build plugin so the two never share compiler state.
  // -------------------------------------------------------------------------
  const projectPlugin = zintl({
    ...exampleOptions,
    prune: false, // Prevent deleting example files
    metadataDir: tempMetadataPath,
    outputDir: relative(exampleRoot, tempOutputDir),
  });

  if ((projectPlugin as any).configResolved) {
    await (projectPlugin as any).configResolved({
      root: exampleRoot,
      command: configEnv.command,
    });
  }

  // -------------------------------------------------------------------------
  // setupFile — temp overlay only, real example never touched
  // -------------------------------------------------------------------------
  const setupFile = async (path: string, content: string): Promise<string> => {
    const fullPath = join(overlayRoot, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    return fullPath;
  };

  // -------------------------------------------------------------------------
  // transform — plugin sees real example paths so boundary IDs are stable
  // -------------------------------------------------------------------------
  const transform = async (path: string, content: string): Promise<string> => {
    const fullPath = join(exampleRoot, path);
    const result = await (projectPlugin as any).transform(content, fullPath);
    if (!result) return content.trim();
    return result.code.trim().replace(/\r\n/g, "\n");
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const readExampleFiles = async (): Promise<Record<string, string>> => {
    const files: Record<string, string> = {};
    const walk = async (dir: string) => {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === ".zintl")
          continue;
        if (s.isDirectory()) {
          await walk(fullPath);
        } else {
          const relPath = relative(exampleRoot, fullPath);
          if (relPath.match(/\.(ts|js|tsx|jsx|html|css|json|svg|png|jpg|ico)$/)) {
            files[relPath] = await readFile(fullPath, "utf-8");
          }
        }
      }
    };
    await walk(exampleRoot);
    return files;
  };

  const filterForSnapshots = (results: Record<string, string>) => {
    const filtered: Record<string, string> = {};
    for (const [path, code] of Object.entries(results)) {
      if (
        (path.startsWith("src/") || path.endsWith(".html") || path.startsWith("virtual:zintl/")) &&
        !path.match(/\.(css|png|jpg|ico|svg|json)$/)
      ) {
        const escapedOverlay = overlayRoot.replace(/\\/g, "/");
        const escapedTempOutput = tempOutputDir.replace(/\\/g, "/");
        let sanitizedCode = code;

        sanitizedCode = sanitizedCode
          .split(overlayRoot)
          .join("<OVERLAY_ROOT>")
          .split(escapedOverlay)
          .join("<OVERLAY_ROOT>")
          .split(tempOutputDir)
          .join("<TEMP_OUTPUT_DIR>")
          .split(escapedTempOutput)
          .join("<TEMP_OUTPUT_DIR>");

        sanitizedCode = sanitizedCode.replace(
          /\.tmp\/example-[a-zA-Z0-9-]+-[a-zA-Z0-9]+/g,
          ".tmp/example-placeholder",
        );
        filtered[path] = sanitizedCode;
      }
    }
    return filtered;
  };

  const filterDistForSnapshots = (results: Record<string, string>) => {
    const filtered: Record<string, string> = {};
    for (const [path, code] of Object.entries(results)) {
      if (path.match(/\.(js|json|html)$/) && !path.endsWith(".css")) {
        filtered[path] = code;
      }
    }
    return filtered;
  };

  // -------------------------------------------------------------------------
  // project — full warmup → flush → final transform pipeline.
  //
  // Safe to call before build() because projectPlugin and the build's plugin
  // instance are completely separate — no shared state, no double-injection.
  // -------------------------------------------------------------------------
  const project = async (files?: Record<string, string>): Promise<Record<string, string>> => {
    // Trigger lifecycle on all example plugins to generate ghost entries/etc
    const mockContext = {
      addWatchFile: () => {},
      emitFile: () => {},
      warn: (msg: any) => console.warn(msg),
      error: (msg: any) => console.error(msg),
    };

    for (const p of examplePlugins) {
      if (p.configResolved) {
        await p.configResolved({
          root: exampleRoot,
          command: configEnv.command,
          mode: configEnv.mode,
        });
      }
      if (p.buildStart) {
        await p.buildStart.apply(mockContext);
      }
    }

    if (projectPlugin.buildStart) {
      await (projectPlugin.buildStart as any)();
    }

    const targetFiles = files ?? (await readExampleFiles());
    const absPaths: Record<string, string> = {};
    for (const path of Object.keys(targetFiles)) {
      absPaths[path] = join(exampleRoot, path);
    }

    // Warmup — extraction pass, populates the compiler's message catalog
    for (const [path, content] of Object.entries(targetFiles)) {
      await (projectPlugin as any).transform(content, absPaths[path]);
    }

    // Flush catalogs so baking keys are available in the final pass
    if (projectPlugin.buildEnd) {
      await (projectPlugin.buildEnd as any)();
    }

    // Final transform — injects baked or identity keys depending on mode
    const results: Record<string, string> = {};
    for (const [path, content] of Object.entries(targetFiles)) {
      let result = await (projectPlugin as any).transform(content, absPaths[path]);
      let code = result ? result.code : content;

      if (path.endsWith(".html") && (projectPlugin as any).transformIndexHtml) {
        const hook = (projectPlugin as any).transformIndexHtml;
        const handler = typeof hook === "function" ? hook : hook.handler;
        const htmlResult = await handler(code, {
          path: absPaths[path],
          filename: absPaths[path],
        });
        code = typeof htmlResult === "string" ? htmlResult : htmlResult.html;
      }

      results[path] = code.trim().replace(/\r\n/g, "\n");
    }

    // Virtual module discovery
    const virtuals: Record<string, string> = {};
    const virtualPattern = /"virtual:zintl\/[^"]+"/g;

    const discoverVirtuals = async (code: string) => {
      const matches = code.matchAll(virtualPattern);
      for (const match of matches) {
        const id = match[0].slice(1, -1);
        if (!virtuals[id] && !results[id]) {
          const resolved = await (projectPlugin as any).resolveId(id);
          if (resolved) {
            const loaded = await (projectPlugin as any).load(resolved.id || resolved);
            if (loaded) {
              const content = typeof loaded === "string" ? loaded : loaded.code;
              virtuals[id] = content.trim().replace(/\r\n/g, "\n");
              await discoverVirtuals(content); // Recursive discovery
            }
          }
        }
      }
    };

    for (const code of Object.values(results)) {
      await discoverVirtuals(code);
    }

    Object.assign(results, virtuals);

    return results;
  };

  // -------------------------------------------------------------------------
  // build — real vite.config.ts + overrides + test-mode overrides.
  // Always production. Always uses a fresh plugin instance (never projectPlugin).
  // Result is cached per (name + overrides) — mode does not affect the cache
  // key because build() is always production.
  // -------------------------------------------------------------------------
  const build = async (): Promise<BuildOutput> => {
    const cacheKey = `${name}::${JSON.stringify(overrides)}`;

    if (!buildCache.has(cacheKey)) {
      // Load config fresh in production/build mode for the build pipeline,
      // regardless of the mode this context was created with.
      const buildConfigEnv: ConfigEnv = { command: "build", mode: "production" };
      const buildLoaded = await loadConfigFromFile(buildConfigEnv, undefined, exampleRoot);
      const buildConfig: InlineConfig = buildLoaded?.config ?? {};

      buildCache.set(cacheKey, _runBuild(buildConfig, overrides, exampleRoot, tempOutputDir));
    }

    return buildCache.get(cacheKey)!;
  };

  // -------------------------------------------------------------------------
  // cleanup — removes the temp overlay dir
  // -------------------------------------------------------------------------
  const cleanup = async (): Promise<void> => {
    // Trigger buildEnd to cleanup ghost entries/etc
    for (const p of examplePlugins) {
      if (p.buildEnd) {
        await p.buildEnd.apply({
          warn: (msg: any) => console.warn(msg),
          error: (msg: any) => console.error(msg),
        });
      }
    }
  };

  return {
    root: overlayRoot,
    plugin: projectPlugin,
    setupFile,
    transform,
    project,
    build,
    cleanup,
    filterForSnapshots,
    filterDistForSnapshots,
    matchers: createZintlMatchers(projectPlugin),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _runBuild(
  buildConfig: InlineConfig,
  overrides: InlineConfig,
  root: string,
  tempOutputDir?: string,
): Promise<BuildOutput> {
  const testOverrides = buildTestOverrides(buildConfig, root);

  // Merge order (last wins):
  //   1. example's vite.config.ts (loaded in build mode)
  //   2. caller overrides
  //   3. test-mode overrides — write:false, minify:false, ± stable names
  const config = mergeConfig(
    mergeConfig(
      { ...buildConfig, root, logLevel: "silent" as const, define: TEST_DEFINES },
      overrides,
    ),
    { build: testOverrides },
  );

  const zintlPlugin = findZintlPlugin(config);
  if (zintlPlugin && tempOutputDir) {
    // Update the options so when configResolved is called by Vite, it uses the correct paths
    if ((zintlPlugin as any).__options) {
      const opt = (zintlPlugin as any).__options;
      opt.outputDir = relative(root, tempOutputDir);
      opt.prune = false;
      opt.metadataDir = join(dirname(tempOutputDir), "../node_modules", ".zintl");
      opt.verifyIntegrity = true; // Ensure it's on for build
    }
  }

  const result = await viteBuild(config);
  return collectOutput(result as Rollup.RollupOutput | Rollup.RollupOutput[]);
}

function findZintlPlugin(config: InlineConfig): any {
  const plugins = ((config.plugins ?? []) as any[]).flat(Infinity);
  return plugins.find(
    (p: any) => p != null && typeof p === "object" && (p.__options || p.name === "zintl"),
  );
}
