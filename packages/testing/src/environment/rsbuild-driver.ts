import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { compileWithZintl } from "./compile.js";
import type {
  BuildToolDriver,
  BuildOutput,
  CompilationResult,
  ZintlPluginOptions,
} from "./driver.js";

const buildCache = new Map<string, Promise<BuildOutput>>();

/** Mirrors `EXCLUDED_EXTENSIONS` in utils.ts — binary output is not snapshot material. */
const EXCLUDED_EXTENSIONS = new Set([
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
]);

/**
 * A `BuildToolDriver` backed by Rsbuild.
 *
 * It was written to falsify rather than to support (proposal 026): a second
 * host the contract layer can drive, so that "the compiler is bundler-agnostic"
 * has something capable of disagreeing with it. It kept disagreeing, the
 * disagreements got fixed, and Rsbuild is a supported target since proposal
 * 030 — so this now covers builds, and `RsbuildDevServerDriver` next to it
 * covers the dev server and hot updates.
 *
 * The one structural difference from `ViteDriver` is `build()`, and it is not
 * cosmetic. Vite's build returns an in-memory bundle under `write: false`, so
 * output can be read without touching disk. Rsbuild's `BuildOptions` is
 * `{ watch?: boolean }` and its `BuildResult` is `{ close, stats? }` — there is
 * no in-memory mode. So this builds to a directory and reads it back, which is
 * slower and needs its own cleanup, and is simply what the host provides.
 */
export class RsbuildDriver implements BuildToolDriver {
  readonly exampleName: string;
  readonly root: string;
  private readonly zintlOptions: ZintlPluginOptions;

  constructor(exampleName: string, root: string, zintlOptions: ZintlPluginOptions) {
    this.exampleName = exampleName;
    this.root = root;
    this.zintlOptions = zintlOptions;
  }

  /**
   * Identical to `ViteDriver.compile` — literally the same function.
   *
   * Worth noticing rather than skipping past: the compiler contract needed no
   * per-host adaptation at all. Everything that made portability hard lives in
   * the plugin, not the compiler.
   */
  async compile(mode: "development" | "production" = "production"): Promise<CompilationResult> {
    return compileWithZintl(this.root, this.zintlOptions, mode, "rspack");
  }

  async build(overrides: Record<string, any> = {}): Promise<BuildOutput> {
    const cacheKey = `${this.exampleName}::${JSON.stringify(overrides)}`;

    if (!buildCache.has(cacheKey)) {
      buildCache.set(cacheKey, this.runBuildInternal(overrides));
    }

    return buildCache.get(cacheKey)!;
  }

  async dispose(): Promise<void> {
    // Nothing to tear down — the build output directory is inside the
    // per-worker project copy under `.tmp/`, which is rebuilt wholesale.
  }

  private async runBuildInternal(overrides: Record<string, any>): Promise<BuildOutput> {
    /**
     * Imported here rather than at module scope on purpose.
     *
     * `@rsbuild/core` pulls in `@rspack/core` and its native binding, and this
     * module is reachable from the `@zintljs/testing` barrel — so a top-level
     * import would make every Vite contract run, and every unit test that
     * touches the barrel, pay to load a bundler it will never call.
     */
    const { createRsbuild, loadConfig } = await import("@rsbuild/core");

    const distRoot = join(this.root, "dist");
    await rm(distRoot, { recursive: true, force: true });

    const { content: fileConfig } = await loadConfig({ cwd: this.root });

    const rsbuild = await createRsbuild({
      cwd: this.root,
      rsbuildConfig: {
        ...fileConfig,
        ...overrides,
        root: this.root,
        logLevel: "error",
        performance: {
          ...(fileConfig as any)?.performance,
          printFileSize: false,
        },
        output: {
          ...(fileConfig as any)?.output,
          ...(overrides as any)?.output,
          distPath: { root: "dist" },
          /**
           * Deterministic names, for the same reason `buildTestOverrides` forces
           * them on the Vite side: a content hash in a filename turns every
           * codegen change into an unreadable snapshot rename.
           */
          filenameHash: false,
          minify: false,
          sourceMap: false,
        },
      },
    });

    const result = await rsbuild.build();
    await result.close();

    return this.collectDist(distRoot);
  }

  /**
   * Read a built directory back into the same `Record<path, contents>` shape
   * `collectOutput` produces for Vite, so snapshot handling upstream is
   * identical regardless of which host produced the bytes.
   */
  private async collectDist(distRoot: string): Promise<BuildOutput> {
    const files: BuildOutput = {};

    const walk = async (dir: string) => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return; // No dist directory: the build produced nothing.
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        const dotIdx = entry.lastIndexOf(".");
        const ext = dotIdx !== -1 ? entry.slice(dotIdx) : "";
        if (EXCLUDED_EXTENSIONS.has(ext)) continue;

        const relPath = relative(distRoot, fullPath).split("\\").join("/");
        files[relPath] = await readFile(fullPath, "utf-8");
      }
    };

    await walk(distRoot);
    return files;
  }
}
