import type { Options } from "zintljs/vite";

export type { Options as ZintlPluginOptions };

export interface CompilationResult {
  /** Transformed source modules (relative path → code) */
  modules: Record<string, string>;
  /** Generated virtual modules (virtual:zintl/... → code) */
  virtualModules: Record<string, string>;
  /** Serialized boundary graph */
  boundaryGraph: any;
  /** Serialized chunk graph */
  chunkGraph: any;
  /** Extracted messages manifest */
  manifest: Record<string, any>;
}

export type BuildOutput = Record<string, string>;

/**
 * Which build tool a project is driven through.
 *
 * `"vite"` is the default. `"rsbuild"` began as proposal 026's falsification
 * target — a second, non-Rollup host used to disagree with "the compiler is
 * bundler-agnostic" — and is a supported configuration since proposal 030:
 * builds, a real dev server, and hot updates where the framework declares
 * client reactivity. Five projects use it.
 */
export type DriverKind = "vite" | "rsbuild";

export interface BuildTarget {
  /** Human label used for snapshot directory naming */
  name: string;
  /** Build overrides passed to the driver (e.g. `{ build: { ssr: "src/entry-server.ts" } }`) */
  overrides?: Record<string, any>;
}

/**
 * A build tool driver abstracts the mechanics of running a Zintl compilation
 * through a specific bundler. LabPipeline delegates to a driver — today that's
 * always ViteDriver, but FarmDriver or RolldownDriver could satisfy the same
 * interface without changing a single contract test.
 */
export interface BuildToolDriver {
  readonly exampleName: string;
  readonly root: string;

  /**
   * Compile project sources through the Zintl compiler directly.
   * Tests the **compiler's contract** — independent of the build tool.
   */
  compile(mode?: "development" | "production"): Promise<CompilationResult>;

  /**
   * Run a full production build through the real build tool.
   * Tests the **integration contract** — plugin hooks, bundling, etc.
   *
   * Builds are memoised per worker by project and overrides, because most
   * contracts build the same unchanged project and paying for that twice is
   * waste. Pass `{ cache: false }` when the project is **not** unchanged — a
   * contract that edits a file and builds again is asking a different question,
   * and the memo would answer the previous one. Such a build neither reads nor
   * writes the memo, so it also cannot leave a build of an edited tree behind
   * for the next contract to collect.
   */
  build(overrides?: Record<string, any>, opts?: { cache?: boolean }): Promise<BuildOutput>;

  dispose(): Promise<void>;
}
