import { findMonorepoRoot } from "../utils.js";
import { ViteDriver } from "./vite-driver.js";
import type { BuildOutput, ZintlPluginOptions } from "./driver.js";

/**
 * LabPipeline is a thin façade over BuildToolDriver.
 * It owns the snapshot filtering/sanitization helpers and delegates
 * all compilation and building to the driver.
 */
export class LabPipeline {
  public readonly exampleName: string;
  public readonly driver: ViteDriver;
  private readonly MONOREPO_ROOT: string;

  constructor(exampleName: string, exampleRoot: string, zintlOptions: ZintlPluginOptions) {
    this.exampleName = exampleName;
    this.MONOREPO_ROOT = findMonorepoRoot(exampleRoot);
    this.driver = new ViteDriver(exampleName, exampleRoot, zintlOptions);
  }

  async project(
    mode: "development" | "production" = "production",
  ): Promise<Record<string, string>> {
    const result = await this.driver.compile(mode);
    return { ...result.modules, ...result.virtualModules };
  }

  async build(overrides: Record<string, any> = {}): Promise<BuildOutput> {
    return this.driver.build(overrides);
  }

  public sanitizeCode(code: string): string {
    const escapedMonorepoRoot = this.MONOREPO_ROOT.replace(/\\/g, "/");
    return code
      .split(this.MONOREPO_ROOT)
      .join("<MONOREPO_ROOT>")
      .split(escapedMonorepoRoot)
      .join("<MONOREPO_ROOT>");
  }

  filterForSnapshots(results: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [path, code] of Object.entries(results)) {
      if (
        (path.startsWith("src/") || path.endsWith(".html") || path.startsWith("virtual:zintl/")) &&
        !path.match(/\.(css|png|jpg|ico|svg|json)$/)
      ) {
        filtered[path] = this.sanitizeCode(code);
      }
    }
    return filtered;
  }

  filterDistForSnapshots(results: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [path, code] of Object.entries(results)) {
      if (path.match(/\.(js|json|html)$/) && !path.endsWith(".css")) {
        filtered[path] = this.sanitizeCode(code);
      }
    }
    return filtered;
  }
}
