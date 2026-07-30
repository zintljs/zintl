import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  build as viteBuild,
  loadConfigFromFile,
  mergeConfig,
  type ConfigEnv,
  type InlineConfig,
  type Rollup,
} from "vite";
import { ZintlCompiler } from "@zintl/compiler";
import { resolveFacets } from "zintl/facets";
import { assembleFacets, detectFrameworksOrFallback } from "zintl/facets";
import { collectOutput, buildTestOverrides, TEST_DEFINES } from "../utils.js";
import type {
  BuildToolDriver,
  BuildOutput,
  CompilationResult,
  ZintlPluginOptions,
} from "./driver.js";

const buildCache = new Map<string, Promise<BuildOutput>>();

const SOURCE_EXTENSIONS = /\.(ts|js|tsx|jsx|vue|svelte)$/;
const VIRTUAL_PATTERN = /["']virtual:zintl\/[^"']+["']/g;

export class ViteDriver implements BuildToolDriver {
  readonly exampleName: string;
  readonly root: string;
  private readonly zintlOptions: ZintlPluginOptions;

  constructor(exampleName: string, root: string, zintlOptions: ZintlPluginOptions) {
    this.exampleName = exampleName;
    this.root = root;
    this.zintlOptions = zintlOptions;
  }

  /**
   * Compile sources through ZintlCompiler directly — no Vite involved.
   * Tests the compiler contract, not the build tool.
   *
   * Capabilities are resolved exactly the way the plugin resolves them
   * (detect → assemble → resolve), so these contract snapshots measure the
   * production path. Previously this handed plugin-shaped options straight to
   * the compiler and relied on its `VITEST` facet injection, which meant the
   * snapshots recorded a test-only world.
   */
  async compile(mode: "development" | "production" = "production"): Promise<CompilationResult> {
    const isDev = mode === "development";
    const frameworks = detectFrameworksOrFallback({ root: this.root });
    const facets = assembleFacets({
      frameworks,
      ssr: Boolean((this.zintlOptions as any).ssr),
      facets: this.zintlOptions.facets,
      assetsTarget: this.zintlOptions.assetsTarget,
      virtualAssets: this.zintlOptions.virtualAssets,
    });
    const compiler = new ZintlCompiler(
      { ...(this.zintlOptions as any), capabilities: resolveFacets(facets) },
      this.root,
      isDev,
    );

    // Phase 1: setup (loads metadata, initializes facets)
    await compiler.setup();

    // Phase 2: discover (walks files → extraction → dependency graph)
    await compiler.discover();

    // Phase 3: flush (builds boundary+chunk graphs, writes catalogs)
    await compiler.flush();

    // Phase 4: second transform pass — graphs are ready, generates final code
    const sourceFiles = await this.readSourceFiles();
    const modules: Record<string, string> = {};

    for (const [relPath, content] of Object.entries(sourceFiles)) {
      const absPath = join(this.root, relPath);
      const result = await compiler.transform(content, absPath);
      modules[relPath] = (result?.code ?? content).trim().replace(/\r\n/g, "\n");
    }

    // Phase 5: discover and load virtual modules referenced from output
    const virtualModules = await this.collectVirtualModules(compiler, modules);

    return {
      modules,
      virtualModules,
      boundaryGraph: compiler.graph.boundaryGraph ?? null,
      chunkGraph: compiler.graph.chunkGraph ?? null,
      manifest: compiler.messages.internalManifest,
    };
  }

  /**
   * Run a full production build through Vite.
   * Tests the integration contract — real plugin hooks, bundling, etc.
   */
  async build(overrides: Record<string, any> = {}): Promise<BuildOutput> {
    const cacheKey = `${this.exampleName}::${JSON.stringify(overrides)}`;

    if (!buildCache.has(cacheKey)) {
      buildCache.set(cacheKey, this.runBuildInternal(overrides));
    }

    return buildCache.get(cacheKey)!;
  }

  async dispose(): Promise<void> {
    // Nothing to tear down for now — compiler is garbage collected after compile()
  }

  private async runBuildInternal(overrides: Record<string, any>): Promise<BuildOutput> {
    const buildConfigEnv: ConfigEnv = { command: "build", mode: "production" };
    const buildLoaded = await loadConfigFromFile(buildConfigEnv, undefined, this.root);
    const buildConfig: InlineConfig = buildLoaded?.config ?? {};

    const testOverrides = buildTestOverrides(buildConfig, this.root);

    const config = mergeConfig(
      mergeConfig(
        {
          ...buildConfig,
          root: this.root,
          logLevel: "silent" as const,
          define: TEST_DEFINES,
        },
        overrides as InlineConfig,
      ),
      {
        build: testOverrides,
        plugins: [
          {
            name: "zintl-test-dedupe-plugins",
            enforce: "pre",
            configResolved(resolvedConfig: any) {
              const seen = new Set<string>();
              const filtered: any[] = [];
              for (const p of resolvedConfig.plugins) {
                if (p && p.name) {
                  if (seen.has(p.name)) continue;
                  seen.add(p.name);
                }
                filtered.push(p);
              }
              resolvedConfig.plugins.length = 0;
              resolvedConfig.plugins.push(...filtered);
            },
          } as any,
        ],
      },
    );

    const result = await viteBuild(config);
    return collectOutput(result as Rollup.RolldownOutput | Rollup.RolldownOutput[]);
  }

  private async readSourceFiles(): Promise<Record<string, string>> {
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
        } else if (SOURCE_EXTENSIONS.test(entry)) {
          const relPath = relative(this.root, fullPath);
          files[relPath] = await readFile(fullPath, "utf-8");
        }
      }
    };

    await walk(this.root);
    return files;
  }

  private async collectVirtualModules(
    compiler: ZintlCompiler,
    modules: Record<string, string>,
  ): Promise<Record<string, string>> {
    const virtuals: Record<string, string> = {};

    const discover = async (code: string) => {
      const matches = code.matchAll(VIRTUAL_PATTERN);
      for (const match of matches) {
        const id = match[0].slice(1, -1); // strip quotes
        if (virtuals[id]) continue;

        // Parse the virtual ID to find the boundary ID and locale
        // Format: virtual:zintl/content/<locale>/<type>:<boundaryId>
        //         virtual:zintl/catalog/<type>:<boundaryId>
        //         virtual:zintl/manager/<locale>/<type>:<boundaryId>
        const contentMatch = id.match(/^virtual:zintl\/content\/([^/]+)\/([^:]+):(.+)$/);
        const catalogMatch = id.match(/^virtual:zintl\/catalog\/([^:]+):(.+)$/);
        const managerMatch = id.match(/^virtual:zintl\/manager\/([^/]+)\/([^:]+):(.+)$/);

        let generated: { code: string; watchedFiles: string[] } | undefined;

        if (contentMatch) {
          const [, locale, type, bId] = contentMatch;
          generated = await compiler.generateVirtualModule(`${type}:${bId}`, locale);
        } else if (managerMatch) {
          const [, locale, type, bId] = managerMatch;
          const loc = locale === "none" ? undefined : locale;
          generated = await compiler.generateVirtualModule(`${type}:${bId}`, loc, true);
        } else if (catalogMatch) {
          const [, type, bId] = catalogMatch;
          generated = await compiler.generateVirtualModule(`${type}:${bId}`);
        }

        if (generated) {
          virtuals[id] = generated.code.trim().replace(/\r\n/g, "\n");
          await discover(generated.code);
        }
      }
    };

    for (const code of Object.values(modules)) {
      await discover(code);
    }

    return virtuals;
  }
}
