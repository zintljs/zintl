import { ZintlCompiler } from "@zintljs/compiler";
import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { ResolvedOptions } from "./options.js";
import type { BundlerHostView } from "./host.js";

export default class Context {
  public compiler!: ZintlCompiler;
  public server: ViteDevServer | null = null;
  public multiplexEnabled: boolean | null = null;

  /**
   * Host facts supplied out-of-band, by a layer `getNativeBuildContext()`
   * cannot see. Merged over the native view by {@link ensureCompiler}.
   *
   * This exists because a host can be a *stack*. Rsbuild is a configuration,
   * dev-server and HTML layer on top of Rspack, and unplugin hands the plugin
   * Rspack's compiler — so a question Rspack genuinely cannot answer has to be
   * answered by whoever is standing above it. Concretely: Rsbuild leaves
   * `compiler.options.mode` at `"none"` in every action, so the Rspack layer
   * has no dev/production signal at all, while `api.context.action` at the
   * Rsbuild layer says exactly which one it is (ledger L-020).
   *
   * Deliberately a partial view rather than a second full one — anything set
   * here is a fact the inner layer could not supply, not an override of one it
   * did.
   */
  public hostHints: Partial<BundlerHostView> = {};

  /**
   * HTML documents whose entry scripts the host had to declare, because its
   * templates do not name them. Keyed by normalized html id, valued with source
   * ids relative to the root.
   *
   * Populated before the compiler is constructed and handed over as its
   * `htmlEntries` option — see `hooks/html.ts` and ledger L-021.
   */
  public htmlEntries: Record<string, string[]> = {};

  constructor(public options: ResolvedOptions) {}

  getMultiplex(config?: any): boolean {
    if (this.compiler && this.multiplexEnabled !== null) return this.multiplexEnabled;
    const root = config?.root || this.compiler?.rootDir || process.cwd();

    if (this.options.multiplex !== undefined) {
      const val = this.options.multiplex;
      if (this.compiler) {
        this.multiplexEnabled = val;
      }
      return val;
    }

    try {
      const entryFiles: string[] = [];

      // Resolve entries dynamically from Vite configuration
      const userBuild = config?.build || {};
      const userRollupOptions = userBuild.rollupOptions || {};
      const userInput = userRollupOptions.input;

      if (userInput) {
        if (typeof userInput === "string") {
          entryFiles.push(userInput);
        } else if (Array.isArray(userInput)) {
          entryFiles.push(...userInput);
        } else if (typeof userInput === "object" && userInput !== null) {
          entryFiles.push(...(Object.values(userInput) as string[]));
        }
      }

      // Add default entry if none was resolved
      if (entryFiles.length === 0) {
        entryFiles.push("index.html");
      }

      const locales = this.options.locales;
      const cleanEntryFiles = entryFiles.map((file) => {
        let clean = file;
        for (const loc of locales) {
          if (clean.startsWith(`${loc}/`)) {
            clean = clean.slice(loc.length + 1);
            break;
          } else if (clean.startsWith(`./${loc}/`)) {
            clean = clean.slice(loc.length + 3);
            break;
          }
        }
        return clean;
      });

      let content = "";

      // Scan entry files and their referenced script files
      for (const entryFile of cleanEntryFiles) {
        const absoluteEntryPath = isAbsolute(entryFile) ? entryFile : join(root, entryFile);
        // console.log("[Zintl Debug] getMultiplex entry:", {
        //   root,
        //   entryFile,
        //   absoluteEntryPath,
        //   exists: existsSync(absoluteEntryPath),
        // });
        if (existsSync(absoluteEntryPath)) {
          const fileContent = readFileSync(absoluteEntryPath, "utf-8");
          content += fileContent;

          if (entryFile.endsWith(".html")) {
            const scriptMatches = fileContent.matchAll(/<script[^>]+src=["']([^"']+)["']/g);
            for (const match of scriptMatches) {
              const scriptSrc = match[1];
              const cleanScriptSrc = scriptSrc.startsWith("/") ? scriptSrc.slice(1) : scriptSrc;
              const absoluteScriptPath = isAbsolute(cleanScriptSrc)
                ? cleanScriptSrc
                : join(root, cleanScriptSrc);
              // console.log("[Zintl Debug] getMultiplex script:", {
              //   scriptSrc,
              //   cleanScriptSrc,
              //   absoluteScriptPath,
              //   exists: existsSync(absoluteScriptPath),
              // });
              if (existsSync(absoluteScriptPath)) {
                const scriptContent = readFileSync(absoluteScriptPath, "utf-8");
                // console.log(
                //   "[Zintl Debug] scriptContent length:",
                //   scriptContent.length,
                //   "has zintl():",
                //   /zintl\(\s*\)/.test(scriptContent),
                // );
                content += scriptContent;
              }
            }
          }
        }
      }

      // Fallback defaults scan
      const mainPath = join(root, "src/main.ts");
      const indexTsPath = join(root, "src/index.ts");
      if (existsSync(mainPath)) {
        content += readFileSync(mainPath, "utf-8");
      }
      if (existsSync(indexTsPath)) {
        content += readFileSync(indexTsPath, "utf-8");
      }

      let result = false;
      if (/zintl\(\s*['"]\*['"]\s*\)/.test(content) || /zintl\(\s*\)/.test(content)) {
        result = true;
      } else {
        result = false;
      }
      // console.log(
      //   "[Zintl Debug] getMultiplex final result:",
      //   result,
      //   "compiler exists:",
      //   !!this.compiler,
      // );
      if (this.compiler) {
        this.multiplexEnabled = result;
      }
      return result;
    } catch {
      if (this.compiler) {
        this.multiplexEnabled = false;
      }
      return false;
    }
  }

  getMultiplexLocale(id: string): string | undefined {
    const matchSuffix = id.match(/\.zintl-([a-zA-Z0-9_-]+)\.(vue|svelte)/);
    if (matchSuffix) return matchSuffix[1];
    if (!id.includes("zintl-multiplex=")) return undefined;
    const match = id.match(/zintl-multiplex=([^&]+)/);
    return match ? match[1] : undefined;
  }
}
