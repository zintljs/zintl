import { ZintlCompiler } from "@zintl/compiler";
import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { ResolvedOptions } from "./options.js";

export default class Context {
  public compiler!: ZintlCompiler;
  public server: ViteDevServer | null = null;
  public multiplexEnabled: boolean | null = null;

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
