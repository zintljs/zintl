import { findMonorepoRoot } from "../utils.js";
import { ViteDriver } from "./vite-driver.js";
import { RsbuildDriver } from "./rsbuild-driver.js";
import type { BuildOutput, BuildToolDriver, DriverKind, ZintlPluginOptions } from "./driver.js";

/**
 * LabPipeline is a thin façade over BuildToolDriver.
 * It owns the snapshot filtering/sanitization helpers and delegates
 * all compilation and building to the driver.
 */
export class LabPipeline {
  public readonly exampleName: string;
  public readonly driver: BuildToolDriver;
  private readonly MONOREPO_ROOT: string;

  constructor(
    exampleName: string,
    exampleRoot: string,
    zintlOptions: ZintlPluginOptions,
    driver: DriverKind = "vite",
  ) {
    this.exampleName = exampleName;
    this.MONOREPO_ROOT = findMonorepoRoot(exampleRoot);
    this.driver =
      driver === "rsbuild"
        ? new RsbuildDriver(exampleName, exampleRoot, zintlOptions)
        : new ViteDriver(exampleName, exampleRoot, zintlOptions);
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
    return (
      code
        .split(this.MONOREPO_ROOT)
        .join("<MONOREPO_ROOT>")
        .split(escapedMonorepoRoot)
        .join("<MONOREPO_ROOT>")
        /**
         * Public-directory assets resolve outside the project, so the bundler
         * emits a `#region` breadcrumb whose `../` depth tracks the absolute
         * depth of the checkout — `/Users/x/Lingua/lingua` yields one fewer
         * than `/home/runner/work/zintl/zintl`. That is not portable, so the
         * escape prefix is collapsed.
         *
         * Scoped to `#region` lines on purpose: vendored sources legitimately
         * contain relative paths (Svelte's own JSDoc references
         * `'../../reactivity/batch.js'`) and must be left untouched.
         */
        .replace(/(#(?:end)?region\s+)(?:\.\.\/)+/g, "$1<OUTSIDE_ROOT>/")
        /**
         * A worker-scoped copy is the *same project* as its origin, so its
         * output must be byte-identical. Without this, snapshots would encode
         * `.tmp/runs/w1/react-basic/...` and depend on which source kind and
         * which worker produced them — the exact opposite of the identity these
         * snapshots exist to pin.
         */
        .replace(/\.tmp[/\\]runs[/\\]w[^/\\]+[/\\]/g, "examples/")
        /**
         * The same two normalizations again, for paths that are no longer
         * paths.
         *
         * Rspack names a module's binding after its absolute resource path with
         * every separator flattened to an underscore, so an import arrives as
         * `_Users_me_repo__tmp_runs_w1_project_src_about_txt_…`. The rules above
         * only match slash-shaped paths and slide straight past it, which makes
         * the output vary by checkout location and by which worker produced it —
         * exactly what those rules exist to prevent.
         *
         * Worth noticing rather than just fixing: a build output that embeds the
         * absolute source path is not portable between machines, and Zintl
         * invites it here by identifying generated asset modules with the source
         * file's real path plus a query. An extension-free virtual id would
         * flatten to something short and stable. See ledger L-009.
         */
        .split(escapedMonorepoRoot.replace(/[/\\.]/g, "_"))
        .join("<MONOREPO_ROOT>")
        .replace(/_tmp_runs_w[^_]+_/g, "_tmp_runs_wN_")
    );
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
