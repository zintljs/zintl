import { ZintlCompiler, type ZintlOptions } from "@zintl/compiler";
import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class ZintlPluginContext {
  public compiler!: ZintlCompiler;
  public server: ViteDevServer | null = null;
  public multiplexEnabled: boolean | null = null;

  constructor(public options: ZintlOptions) {}

  getMultiplex(config?: any): boolean {
    if (this.multiplexEnabled !== null) return this.multiplexEnabled;
    const root = config?.root || this.compiler?.rootDir || process.cwd();

    if ((this.options as any).multiplex !== undefined) {
      this.multiplexEnabled = (this.options as any).multiplex;
      return this.multiplexEnabled!;
    }

    try {
      const mainPath = join(root, "src/main.ts");
      const indexPath = join(root, "index.html");

      let content = "";
      if (existsSync(mainPath)) {
        content += readFileSync(mainPath, "utf-8");
      }
      if (existsSync(indexPath)) {
        content += readFileSync(indexPath, "utf-8");
      }

      if (/zintl\(\s*['"]\*['"]\s*\)/.test(content) || /zintl\(\s*\)/.test(content)) {
        this.multiplexEnabled = true;
      } else {
        this.multiplexEnabled = false;
      }
    } catch {
      this.multiplexEnabled = false;
    }

    return this.multiplexEnabled;
  }

  getMultiplexLocale(id: string): string | undefined {
    if (!id.includes("zintl-multiplex=")) return undefined;
    const match = id.match(/zintl-multiplex=([^&]+)/);
    return match ? match[1] : undefined;
  }
}
