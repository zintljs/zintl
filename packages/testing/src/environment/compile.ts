import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { ZintlCompiler } from "@zintljs/compiler";
import { assembleFacets, detectFrameworksOrFallback, resolveFacets } from "zintljs/facets";
import type { CompilationResult, ZintlPluginOptions } from "./driver.js";

const SOURCE_EXTENSIONS = /\.(ts|js|tsx|jsx|vue|svelte)$/;
const VIRTUAL_PATTERN = /["']virtual:zintl\/[^"']+["']/g;

/**
 * Compile a project through `ZintlCompiler` directly, with no bundler involved.
 *
 * Shared by every `BuildToolDriver`, and that sharing is the point rather than
 * a convenience: this path already touched no bundler API, so the fact that
 * two hosts can run it unchanged is the strongest evidence available that the
 * compiler's own contract is host-independent. If a bundler ever needs its own
 * version of this function, that is a finding about the compiler, not a
 * reason to fork the helper.
 *
 * Capabilities resolve exactly the way the plugin resolves them
 * (detect → assemble → resolve), so contract snapshots measure the production
 * path rather than a test-only world.
 */
export async function compileWithZintl(
  root: string,
  zintlOptions: ZintlPluginOptions,
  mode: "development" | "production" = "production",
): Promise<CompilationResult> {
  const isDev = mode === "development";
  const frameworks = detectFrameworksOrFallback({ root });
  const facets = assembleFacets({
    frameworks,
    ssr: Boolean((zintlOptions as any).ssr),
    facets: zintlOptions.facets,
    assetsTarget: zintlOptions.assetsTarget,
    virtualAssets: zintlOptions.virtualAssets,
  });
  const compiler = new ZintlCompiler(
    { ...(zintlOptions as any), capabilities: resolveFacets(facets) },
    root,
    isDev,
  );

  // Phase 1: setup (loads metadata, initializes facets)
  await compiler.setup();

  // Phase 2: discover (walks files → extraction → dependency graph)
  await compiler.discover();

  // Phase 3: flush (builds boundary+chunk graphs, writes catalogs)
  await compiler.flush();

  // Phase 4: second transform pass — graphs are ready, generates final code
  const sourceFiles = await readSourceFiles(root);
  const modules: Record<string, string> = {};

  for (const [relPath, content] of Object.entries(sourceFiles)) {
    const absPath = join(root, relPath);
    const result = await compiler.transform(content, absPath);
    modules[relPath] = (result?.code ?? content).trim().replace(/\r\n/g, "\n");
  }

  // Phase 5: discover and load virtual modules referenced from output
  const virtualModules = await collectVirtualModules(compiler, modules);

  return {
    modules,
    virtualModules,
    boundaryGraph: compiler.graph.boundaryGraph ?? null,
    chunkGraph: compiler.graph.chunkGraph ?? null,
    manifest: compiler.messages.internalManifest,
  };
}

async function readSourceFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string) => {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const s = await stat(fullPath);
      if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === ".zintl")
        continue;
      if (s.isDirectory()) {
        await walk(fullPath);
      } else if (SOURCE_EXTENSIONS.test(entry)) {
        files[relative(root, fullPath)] = await readFile(fullPath, "utf-8");
      }
    }
  };

  await walk(root);
  return files;
}

async function collectVirtualModules(
  compiler: ZintlCompiler,
  modules: Record<string, string>,
): Promise<Record<string, string>> {
  const virtuals: Record<string, string> = {};

  const discover = async (code: string) => {
    const matches = code.matchAll(VIRTUAL_PATTERN);
    for (const match of matches) {
      const id = match[0].slice(1, -1); // strip quotes
      if (virtuals[id]) continue;

      // Parse the virtual ID to find the boundary ID and locale
      // Format: virtual:zintl/content/<locale>/<type>:<boundaryId>
      //         virtual:zintl/catalog/<type>:<boundaryId>
      //         virtual:zintl/manager/<locale>/<type>:<boundaryId>
      const contentMatch = id.match(/^virtual:zintl\/content\/([^/]+)\/([^:]+):(.+)$/);
      const catalogMatch = id.match(/^virtual:zintl\/catalog\/([^:]+):(.+)$/);
      const managerMatch = id.match(/^virtual:zintl\/manager\/([^/]+)\/([^:]+):(.+)$/);

      let generated: { code: string; watchedFiles: string[] } | undefined;

      if (contentMatch) {
        const [, locale, type, bId] = contentMatch;
        generated = await compiler.generateVirtualModule(`${type}:${bId}`, locale);
      } else if (managerMatch) {
        const [, locale, type, bId] = managerMatch;
        const loc = locale === "none" ? undefined : locale;
        generated = await compiler.generateVirtualModule(`${type}:${bId}`, loc, true);
      } else if (catalogMatch) {
        const [, type, bId] = catalogMatch;
        generated = await compiler.generateVirtualModule(`${type}:${bId}`);
      }

      if (generated) {
        virtuals[id] = generated.code.trim().replace(/\r\n/g, "\n");
        await discover(generated.code);
      }
    }
  };

  for (const code of Object.values(modules)) {
    await discover(code);
  }

  return virtuals;
}
