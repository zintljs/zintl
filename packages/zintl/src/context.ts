import { ZintlCompiler } from "@zintljs/compiler";
import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { ResolvedOptions } from "./options.js";
import type { BundlerHostView } from "./host.js";
import type { HostUpdateApplier } from "./hmr/applier.js";

/**
 * The one method of `RsbuildDevServer` Zintl calls.
 *
 * Declared structurally rather than imported, like `RsbuildSetupApi` in
 * `plugin.ts` and for the same reason: `zintljs` takes no hard dependency on
 * `@rsbuild/core`. `sockWrite` is documented on that type as how middleware asks
 * the HMR client to act, and `'full-reload'` is one of the message types it
 * names — the Rsbuild counterpart of Vite's `server.ws.send`.
 */
export interface RsbuildDevServerLike {
  sockWrite: (type: "full-reload", data?: { path?: string }) => void;
}

/**
 * A fixed-capacity ring: overwrites oldest, never grows.
 *
 * Mirrors `DeliveryBus`'s own `Ring` (`packages/compiler/src/bus/index.ts`) —
 * not imported from there because it isn't exported past that package's
 * public surface, and duplicating ~15 lines beats adding a new export just
 * for this.
 */
class Ring<T> {
  private readonly items: (T | undefined)[];
  private next = 0;
  private full = false;

  constructor(private readonly capacity: number) {
    this.items = Array.from({ length: capacity }, () => undefined as T | undefined);
  }

  push(item: T) {
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.full = true;
  }

  /** Oldest first. */
  toArray(): T[] {
    if (!this.full) return this.items.slice(0, this.next) as T[];
    return [...this.items.slice(this.next), ...this.items.slice(0, this.next)] as T[];
  }
}

/**
 * One event in `handleHotUpdateHook`'s own account of what it did — not what
 * was delivered (the compiler's `DeliveryBus`, channel `build/hmr`, already
 * records that half). Diagnosing ledger L-022's §2.4, this is the half that
 * had no record at all: whether the hook ran, what Vite handed it, and every
 * `mod.file` reassignment the fallback scan performs.
 *
 * Read back by the test harness, not printed — `hooks/hmr.ts` previously
 * logged this same information through `DEBUG`-gated `vLogger.debug` calls,
 * and enabling exactly that scope was found to suppress the hook's own
 * invocation entirely (a real, separate, pre-existing effect — not caused by
 * this trace, but reason enough not to trust console output as an
 * observation channel here). A ring buffer that never calls `console.*`
 * can't perturb the timing it's trying to observe.
 */
export interface HmrTraceEntry {
  ts: number;
  kind: "skip-writing" | "skip-ineligible" | "enter" | "repoint" | "return" | "watch";
  file: string;
  seq?: number;
  modulesLength?: number;
  /** `repoint` only. */
  moduleId?: string;
  oldFile?: string;
  newFile?: string;
  boundaryId?: string;
  fileId?: string;
  /** `return` only. */
  invalidatedCount?: number;
  passthrough?: boolean;
  /**
   * `watch` only — why a host watch cycle did or did not reach the plan.
   *
   * A cycle that declines leaves no other trace, so "the hook never ran" and
   * "the hook ran and found nothing to do" were indistinguishable in the
   * diagnosis. They have different causes and the difference cost a full
   * investigation (ledger L-041).
   */
  reason?: string;
}

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

  /**
   * How hot updates reach this host's live module graph, or `null` if they do
   * not reach it at all.
   *
   * Never assigned by shared code. Each host's escape hatch contributes its own
   * — Vite's from `configureServerHook`, Rspack's from the plugin's
   * `rspack(compiler)` block — which is what keeps `switch (bundler)` out of the
   * hot-update path entirely. See `hmr/applier.ts` and proposal 029.
   *
   * `null` is a supported state and means exactly what it says: this host has no
   * hot-update story, so `handleHotUpdateHook` declines rather than guessing one.
   */
  public updateApplier: HostUpdateApplier | null = null;

  /**
   * Rsbuild's dev server, once it exists — the channel for updates that cannot
   * be patched and need the page back.
   *
   * The counterpart of {@link server} for the other host, and separate from it
   * for the same reason `rspackFacet` and the `rsbuild: {}` block are separate:
   * Rspack has no dev server, Rsbuild's is a layer above it. Null under raw
   * Rspack, and null until `onBeforeStartDevServer` fires.
   */
  public rsbuildServer: RsbuildDevServerLike | null = null;

  /** See {@link HmrTraceEntry}. */
  public readonly hmrTrace = new Ring<HmrTraceEntry>(256);

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
