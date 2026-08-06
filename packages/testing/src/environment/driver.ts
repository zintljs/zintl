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
 * `"vite"` is the default and the supported path. `"rsbuild"` exists for
 * proposal 026 — a second, non-Rollup host used to falsify the claim that the
 * compiler is bundler-agnostic. A manifest opting into it is opting into
 * ZDB §7a Tier 1 only: build, no dev server, no hot updates.
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
   */
  build(overrides?: Record<string, any>): Promise<BuildOutput>;

  dispose(): Promise<void>;
}
