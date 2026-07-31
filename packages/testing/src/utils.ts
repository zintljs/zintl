import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InlineConfig, Rollup } from "vite";
import { expect } from "vite-plus/test";
import { generateMessageId } from "@zintljs/compiler";

export type BuildOutput = Record<string, string>;

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

const BASE_TEST_OVERRIDES = {
  write: false,
  minify: false,
  sourcemap: false,
} as const;

export const TEST_DEFINES = {
  "process.env.NODE_ENV": JSON.stringify("production"),
  "import.meta.env.DEV": "false",
} as const;

const LIB_OUTPUT_OVERRIDES = {
  rollupOptions: {
    output: {
      entryFileNames: "[name].js",
      chunkFileNames: "[name].js",
      assetFileNames: "[name].[ext]",
    },
  },
} as const;

export function buildTestOverrides(
  config: InlineConfig,
  root: string,
): Partial<InlineConfig["build"]> {
  const isLibMode = !!(config.build as any)?.lib;
  const hasHtmlEntry = !isLibMode && existsSync(join(root, "index.html"));

  if (isLibMode || !hasHtmlEntry) {
    return { ...BASE_TEST_OVERRIDES, ...LIB_OUTPUT_OVERRIDES };
  }

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

export function findMonorepoRoot(startDir: string): string {
  const markers = ["pnpm-workspace.yaml", "pnpm-lock.yaml", "turbo.json", "lerna.json"];
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (markers.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export function collectOutput(
  result: Rollup.RolldownOutput | Rollup.RolldownOutput[],
  excludeExtensions = EXCLUDED_EXTENSIONS,
): BuildOutput {
  const bundles = Array.isArray(result) ? result : [result];
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

function sha1(str: string): string {
  return createHash("sha1").update(str).digest("hex").slice(0, 8);
}

export function createZintlMatchers(plugin: any) {
  const getCompiler = () => {
    const compiler =
      plugin.__compiler || (globalThis as any).__zintl_active_contexts?.[0]?.compiler;
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

      const hashedId = sha1(text).slice(0, 8);
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mgrVar = `_zintl_mgr_${ownerSafeId}`;
      const escapedSafeId = sourceSafeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

      const localePart = opts.locale ? `locale: "${opts.locale}"` : `(?:locale: [^,]+)?`;

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
