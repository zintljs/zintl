/**
 * utils.ts
 *
 * Internal utilities shared between createZintlContext and createExampleContext.
 * Import from here — never duplicate these across context files.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InlineConfig, Rollup } from "vite";
import { expect } from "vite-plus/test";
import { generateMessageId } from "@zintl/compiler";

/**
 * Resiliently remove a directory with retries.
 * Useful for high-concurrency test runs where file locks might occur.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Flat map of output filename → file content returned by every build(). */
export type BuildOutput = Record<string, string>;

export interface TestContext {
  /** Absolute path to the root directory this context operates in. */
  root: string;
  /** The raw plugin instance (for low-level assertions). */
  plugin: any;
  /** Write a file into root and return its absolute path. */
  setupFile: (path: string, content: string) => Promise<string>;
  /** Run the plugin's transform hook on a single file and return the result. */
  transform: (path: string, content: string) => Promise<string>;
  /** Write + warmup + flush + final-transform a set of files (defaults to all files in root). */
  project: (files?: Record<string, string>) => Promise<Record<string, string>>;
  /** Run a full Vite build and return all emitted text files in memory. */
  build: () => Promise<BuildOutput>;
  /** Tear down any resources created by this context. */
  cleanup: () => Promise<void>;
  /** Filter results for source snapshots. */
  filterForSnapshots: (results: Record<string, string>) => Record<string, string>;
  /** Filter results for dist snapshots. */
  filterDistForSnapshots: (results: Record<string, string>) => Record<string, string>;
  /** Pre-bound assertion helpers scoped to this context's plugin instance. */
  matchers: ReturnType<typeof createZintlMatchers>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
 * Base test-mode overrides that are always safe to apply regardless of
 * whether the example is a Vite app or a lib.
 */
export const BASE_TEST_OVERRIDES = {
  write: false, // keep everything in memory — no dist/ folder created
  minify: false, // human-readable output → meaningful snapshot diffs
  sourcemap: false,
} as const;

export const TEST_DEFINES = {
  "process.env.NODE_ENV": JSON.stringify("production"),
  "import.meta.env.DEV": "false",
} as const;

/**
 * Additional output overrides that are only safe for lib-mode builds.
 * Applying entryFileNames/chunkFileNames to an HTML-entry app build causes
 * Rolldown to fail because the app pipeline manages output names differently.
 */
const LIB_OUTPUT_OVERRIDES = {
  rollupOptions: {
    output: {
      entryFileNames: "[name].js",
      chunkFileNames: "[name].js",
      assetFileNames: "[name].[ext]",
    },
  },
} as const;

/**
 * Returns the correct set of test-mode build overrides for a given resolved
 * config. App-mode builds (index.html entry, no build.lib) only get the base
 * overrides; lib-mode builds additionally get stable hash-free output names.
 */
export function buildTestOverrides(
  config: InlineConfig,
  root: string,
): Partial<InlineConfig["build"]> {
  const isLibMode = !!(config.build as any)?.lib;
  const hasHtmlEntry = !isLibMode && existsSync(join(root, "index.html"));

  if (isLibMode || !hasHtmlEntry) {
    // Lib mode or no HTML — safe to lock down output filenames
    return { ...BASE_TEST_OVERRIDES, ...LIB_OUTPUT_OVERRIDES };
  }

  // App mode (index.html entry) — lock down JS output filenames nested under assets/ to prevent hash drifts in snapshots without affecting assets/HTML fanning
  return {
    ...BASE_TEST_OVERRIDES,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Monorepo root resolution
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` until we find a directory containing a
 * `pnpm-workspace.yaml` (or `pnpm-lock.yaml`) — that's the monorepo root.
 * Falls back to `startDir` if nothing is found within 10 levels.
 */
export function findMonorepoRoot(startDir: string): string {
  const markers = ["pnpm-workspace.yaml", "pnpm-lock.yaml", "turbo.json", "lerna.json"];
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (markers.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return startDir;
}

// ---------------------------------------------------------------------------
// Output collection
// ---------------------------------------------------------------------------

/**
 * Flatten a Vite programmatic build result into a filename → content map,
 * skipping binary / source-map files.
 */
export function collectOutput(
  result: Rollup.RolldownOutput | Rollup.RolldownOutput[],
  excludeExtensions = EXCLUDED_EXTENSIONS,
): BuildOutput {
  const bundles: Rollup.RolldownOutput[] = Array.isArray(result) ? result : [result];
  const files: BuildOutput = {};

  for (const bundle of bundles) {
    for (const chunk of bundle.output) {
      const dotIdx = chunk.fileName.lastIndexOf(".");
      const ext = dotIdx !== -1 ? chunk.fileName.slice(dotIdx) : "";
      if (excludeExtensions.has(ext)) continue;

      files[chunk.fileName] =
        chunk.type === "chunk"
          ? chunk.code
          : typeof chunk.source === "string"
            ? chunk.source
            : Buffer.from(chunk.source as Uint8Array).toString("utf-8");
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sha1(str: string): string {
  return createHash("sha1").update(str).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export function createZintlMatchers(plugin: any) {
  const getCompiler = () => {
    const compiler = plugin.__compiler;
    if (!compiler) {
      throw new Error(
        "Compiler not initialized. Did you call setupFile / transform / project first?",
      );
    }
    return compiler;
  };

  return {
    toImportFromZintl(code: string, imports: string[], source: string = "zintl") {
      for (const i of imports) {
        // Allow zintl or zintl/internal depending on what is being checked
        expect(code).toMatch(
          new RegExp(`import\\s*{[^}]*\\b${i}\\b[^}]*}\\s*from\\s*["']${source}["'];?`),
        );
      }
    },

    toNotImportFromZintl(code: string, imports: string[]) {
      for (const i of imports) {
        expect(code).not.toMatch(
          new RegExp(`import\\s*{[^}]*\\b${i}\\b[^}]*}\\s*from\\s*["']zintl["']`),
        );
      }
    },

    toRegisterManager(code: string, boundaryPath: string, opts: { locale?: string } = {}) {
      const compiler = getCompiler();
      // If it looks like a hashed ID already, use it. Otherwise, get it from compiler.
      const safeId = boundaryPath.startsWith("b_")
        ? boundaryPath
        : compiler.getSafeBoundaryId(boundaryPath);
      const locale = opts.locale ?? compiler.sourceLocale ?? "en";

      const encodedId = encodeURIComponent(safeId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const endcodePath = encodeURIComponent(boundaryPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(
        `import\\s+_zintl_mgr_${safeId}\\s+from\\s+['"]virtual:zintl/manager/${locale}/(?:entry|lazy|shared|boundary):(?:${encodedId}|${endcodePath})['"];?`,
      );

      expect(code).toMatch(regex);
    },

    toRegisterT(
      code: string,
      text: string,
      ownerPath: string,
      opts: { context?: string; sourceBoundaryPath?: string } = { context: "text" },
    ) {
      const compiler = getCompiler();
      const ownerSafeId = compiler.getSafeBoundaryId(ownerPath);
      const sourceSafeId = compiler.getSafeBoundaryId(opts.sourceBoundaryPath || ownerPath);

      // Simple text-only hash
      const hashedId = sha1(text).slice(0, 8);

      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mgrVar = `_zintl_mgr_${ownerSafeId}`;
      const escapedSafeId = sourceSafeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // _bId: \"src/main:render\" | sourceSafeId}
      const regex = new RegExp(
        `(?:t|_t)\\("(?:${hashedId}|${escapedText})",.*_mgr:\\s*${mgrVar},.*_bId:\\s*"(?:${escapedSafeId}|${ownerPath})"`,
      );

      expect(code).toMatch(regex);
    },

    toRegisterMessage(code: string, text: string, translation?: string) {
      const id = generateMessageId(text);
      if (translation) {
        expect(code).toContain(`"${id}": "${translation}"`);
      } else {
        expect(code).toContain(`"${id}"`);
      }
    },

    toHandshake(code: string, boundaryPath: string, opts: { locale?: string } = {}) {
      const compiler = getCompiler();
      const safeId = compiler.getSafeBoundaryId(boundaryPath);
      const mgrVar = `_zintl_mgr_${safeId}`;
      const escapedSafeId = safeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Handle the locale part (can be explicit or omitted)
      const localePart = opts.locale ? `locale: "${opts.locale}"` : `(?:locale: [^,]+)?`;

      // Use a more permissive regex that handles nested braces and varying whitespace
      const regex = new RegExp(
        `loadI18nInstance\\(.*${localePart}.*loaders:\\s*{.*\\s*\\["${escapedSafeId}"\\]:\\s*${mgrVar}\\.loader`,
      );

      expect(code).toMatch(regex);
    },

    toBeBakedTo(code: string, expected: string) {
      expect(code).toContain(expected);
    },
  };
}
