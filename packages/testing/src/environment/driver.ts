import type { ZintlPluginOptions } from "zintl";

export type { ZintlPluginOptions };

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
