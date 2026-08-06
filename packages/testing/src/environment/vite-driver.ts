import {
  build as viteBuild,
  loadConfigFromFile,
  mergeConfig,
  type ConfigEnv,
  type InlineConfig,
  type Rollup,
} from "vite";
import { collectOutput, buildTestOverrides, TEST_DEFINES } from "../utils.js";
import { compileWithZintl } from "./compile.js";
import type {
  BuildToolDriver,
  BuildOutput,
  CompilationResult,
  ZintlPluginOptions,
} from "./driver.js";

const buildCache = new Map<string, Promise<BuildOutput>>();

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
   */
  async compile(mode: "development" | "production" = "production"): Promise<CompilationResult> {
    return compileWithZintl(this.root, this.zintlOptions, mode);
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
}
