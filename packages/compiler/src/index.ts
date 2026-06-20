import * as Extractor from "@zintl/extractor";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  observe,
  resolve,
  apply,
  validate,
  formIntent,
  findEffectiveAnchor,
  resolveOwner,
  getReachableHandshake,
  type WorldState,
} from "./pipeline/index.js";
import { sha1, generateMessageId } from "./utils/hashing.js";
import {
  DEFAULT_SOURCE_LOCALE,
  DEFAULT_LOCALES,
  DEFAULT_OUTPUT_DIR,
  SAVE_DEBOUNCE_MS,
} from "./constants.js";
import {
  type ZintlOptions,
  type ZintlLogger,
  type LogLevel,
  type AssetTargetConfig,
  type AssetMergeStrategy,
} from "./types/index.js";

import { IOManager } from "./managers/IOManager.js";
import { GraphManager } from "./managers/GraphManager.js";
import { CatalogManager } from "./managers/CatalogManager.js";
import { MessageManager } from "./managers/MessageManager.js";
import { HtmlManager } from "./managers/HtmlManager.js";
import { AssetManager } from "./managers/AssetManager.js";

export { generateMessageId, sha1 } from "./utils/hashing.js";
export { similarity } from "./reconcile.js";
export type { ZintlOptions, ZintlLogger, LogLevel, AssetTargetConfig, AssetMergeStrategy };

export class ZintlCompiler {
  public readonly io: IOManager;
  public readonly graph: GraphManager;
  public readonly catalog: CatalogManager;
  public readonly messages: MessageManager;
  public readonly html: HtmlManager;
  public readonly assets: AssetManager;
  public readonly ssrBoundaries = new Set<string>();
  public readonly clientBoundaries = new Set<string>();

  private graphDirty = true;
  private readonly extensions: string[];

  private readonly sourceLocale: string;
  private readonly locales: string[];
  private readonly root: string;
  public readonly isDev: boolean;
  private readonly logger: ZintlLogger;
  private _outputDir: string;
  private _prune: boolean;
  private _verifyIntegrity: boolean;
  private readonly debug?: boolean | string;

  public get _logger() {
    return this.logger;
  }

  public get rootDir() {
    return this.root;
  }

  public get outputDir() {
    return this._outputDir;
  }
  public set outputDir(dir: string) {
    this._outputDir = dir;
    if (this.catalog) this.catalog.outputDir = dir;
  }

  public get prune() {
    return this._prune;
  }
  public set prune(value: boolean) {
    this._prune = value;
    if (this.catalog) this.catalog.prune = value;
  }
  public set metadataDir(dir: string) {
    this.io.setMetadataDir(dir);
  }

  public isSsrEntryTarget(id: string): boolean {
    const targets = this._options?.ssrEntryTargets;
    if (!targets || targets.length === 0) return false;
    const cleanId = id.startsWith("\0") ? id.slice(1) : id;
    return targets.some((target) => {
      if (typeof target === "string") {
        return cleanId.includes(target) || id.includes(target);
      }
      if (target instanceof RegExp) {
        return target.test(cleanId) || target.test(id);
      }
      if (typeof target === "function") {
        return target(id) || target(cleanId);
      }
      return false;
    });
  }

  private hashCache: Record<string, any> = {};
  private observationCache: Record<string, any> = {};
  private readonly boundaryRevisions = new Map<string, number>();
  private rebuildPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> | null = null;
  private autoFlushTimeout: NodeJS.Timeout | null = null;
  private discoveryPhase = false;
  /** Boundaries whose catalog/schema files have been confirmed present on disk. Cleared when they become affected/dirty. */
  private readonly confirmedOnDisk = new Set<string>();
  private reachableCache: Set<string> | null = null;

  public _options: ZintlOptions;

  constructor(options: ZintlOptions = {}, root: string = process.cwd(), isDev: boolean = false) {
    let targets = options.targets || ["vanilla", "react", "html"];
    if (targets.includes("auto")) {
      targets = ["vanilla", "react", "html"];
    }
    options.targets = targets;
    options.assetsTarget = options.assetsTarget || ["md", "txt", "png", "jpg", "jpeg", "webp"];
    this._options = options;
    this.extensions = options.extensions || [".ts", ".tsx", ".js", ".jsx", ".html"];
    this.sourceLocale = options.sourceLocale || DEFAULT_SOURCE_LOCALE;
    this.locales = options.locales || DEFAULT_LOCALES;
    this.root = root;
    this.isDev = isDev;
    this.debug = options.debug;

    const ZL = (Extractor as any).ZintlLogger;
    this.logger = new ZL({
      level: options.logLevel,
      prefix: "Zintl/Compiler",
      debug: options.debug,
    }) as ZintlLogger;

    this._outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
    this._prune = options.prune ?? true;
    this._verifyIntegrity = options.verifyIntegrity ?? false;
    this.io = new IOManager(root, isDev, this.logger.withPrefix("IO"), options);
    this.graph = new GraphManager(this.io, isDev, this.logger.withPrefix("Graph"), this.locales);
    this.catalog = new CatalogManager(
      this.io,
      root,
      this._outputDir,
      this.sourceLocale,
      isDev,
      options.catalogFormat,
      this.logger.withPrefix("Catalog"),
      this._prune,
      this.extensions,
    );
    this.messages = new MessageManager(
      this.io,
      options.similarityThreshold,
      this.logger.withPrefix("Messages"),
    );
    this.html = new HtmlManager(
      this.io,
      root,
      this._outputDir,
      this.sourceLocale,
      this.logger.withPrefix("HTML"),
      this.catalog,
    );
    this.assets = new AssetManager(
      this.io,
      root,
      this.sourceLocale,
      this.locales,
      this.logger.withPrefix("Assets"),
      this.catalog,
      options,
      () => this.messages.dependencyGraph,
      () => this.messages.hive,
      () => this.messages.markHiveDirty(),
      () => this.graph.boundaryGraph,
    );
  }

  public getWorldState(): WorldState {
    return this.createWorldState();
  }

  public resolveVirtualPath(id: string): string {
    if (this._options.resolveVirtualPath) {
      return this._options.resolveVirtualPath(id);
    }
    return id;
  }

  public generateDynamicImport(path: string): string {
    if (this._options.dynamicImportTemplate) {
      return this._options.dynamicImportTemplate(path, this.isDev);
    }
    return `import(${this.isDev ? "/* @vite-ignore */ " : ""}${JSON.stringify(path)})`;
  }

  public get internalManifest() {
    return this.messages.internalManifest;
  }
  public set internalManifest(v) {
    (this.messages as any).internalManifest = v;
  }
  public get dependencyGraph() {
    return this.messages.dependencyGraph;
  }
  public set dependencyGraph(v) {
    (this.messages as any).dependencyGraph = v;
  }
  public get metadataGraph() {
    return this.messages.metadataGraph;
  }
  public set metadataGraph(v) {
    (this.messages as any).metadataGraph = v;
  }
  public get dirtyBoundaries() {
    return this.messages.dirtyBoundaries;
  }
  public set dirtyBoundaries(v) {
    (this.messages as any).dirtyBoundaries = v;
  }
  public get boundaryGraph() {
    return this.graph.boundaryGraph;
  }
  public set boundaryGraph(v) {
    (this.graph as any).boundaryGraph = v;
  }
  public get _chunkGraph() {
    return this.graph.chunkGraph;
  }
  public set _chunkGraph(v) {
    (this.graph as any).chunkGraph = v;
  }
  public get ioManager() {
    return this.io;
  }

  public async setup() {
    await this.messages.loadMetadata();
    if (this.messages.registeredAssets && this.messages.registeredAssets.length > 0) {
      this.assets.setRegisteredAssets(this.messages.registeredAssets);
    }
    await this.catalog.harvestHive(
      this.messages.internalManifest,
      this.locales,
      this.messages.hive,
      () => this.messages.markHiveDirty(),
    );
  }

  public async safeGenerateSchema(path: string, msgs: any[]) {
    return this.catalog.generateSchema(path, msgs);
  }
  public ensureSchemaAtTop(cat: any, sPath: string, cPath: string) {
    return this.catalog.ensureSchemaAtTop(cat, sPath, cPath);
  }

  public getBoundaryId(id: string) {
    return this.io.getBoundaryId(id);
  }
  public getSafeBoundaryId(id: string) {
    return this.io.getSafeBoundaryId(id);
  }
  public getNormalizedId(id: string) {
    return this.io.getNormalizedId(id);
  }
  public async safeWriteFile(path: string, content: string) {
    return this.io.safeWriteFile(path, content);
  }
  public isWritingFile(path: string) {
    return (this.io as any).writingFiles.has(path);
  }
  public isLiveOwner(id: string) {
    return this.graph.isLiveOwner(id, this.messages.internalManifest);
  }
  public isMultilingualFormat() {
    return this.catalog.isMultilingualFormat();
  }
  public getCatalogPath(id: string, loc: string) {
    return this.catalog.getCatalogPath(id, loc);
  }
  public getSchemaPath(id: string) {
    return this.catalog.getSchemaPath(id);
  }
  public isEntry(id: string) {
    return this.graph.boundaryGraph?.entries.has(id) || false;
  }

  public async invalidateFile(filePath: string, force = false): Promise<string[]> {
    if (!force && this.io.writingFiles.has(filePath)) return [];

    const normalizedPath = this.io.getNormalizedId(filePath);
    const absoluteOutputDir = isAbsolute(this.catalog.outputDir)
      ? this.catalog.outputDir
      : join(this.root, this.catalog.outputDir);
    const normalizedOutputDir = this.io.getNormalizedId(absoluteOutputDir);
    const isInsideOutputDir = normalizedPath.startsWith(normalizedOutputDir + "/");

    // If it's a supported asset (md, txt, json, etc) and NOT inside the output dir
    // OR if it's a localized asset inside the output dir
    if (
      (!isInsideOutputDir && this.assets.isSupportedAsset(filePath)) ||
      (isInsideOutputDir && (await this.assets.isLocalizedAsset(filePath)))
    ) {
      if (!isInsideOutputDir) await this.assets.registerAsset(filePath);
      if (this.isDev) {
        this.scheduleFlush();
        return ["b_assets"];
      }
      return [];
    }

    const foundBoundaryIds: string[] = [];

    // 1. Check if it's a source file (boundary ownership)
    const fileId = this.io.getNormalizedId(filePath);
    const boundaries = (this.messages as any).boundaryOwnership.get(fileId);
    if (boundaries) {
      if (this.isDev && this.extensions.some((ext) => filePath.endsWith(ext))) {
        try {
          const code = await this.io.readFile(filePath);
          await this.transform(code, filePath, undefined, true);
        } catch (e) {
          this.logger.error(`Failed to re-extract messages during invalidation: ${String(e)}`);
        }
      }

      for (const bId of boundaries) {
        foundBoundaryIds.push(bId);
        this.messages.dirtyBoundaries.add(bId);
      }
    }

    // 2. Check if it's a catalog file (disk-to-boundary mapping)
    for (const bId of Object.keys(this.messages.internalManifest)) {
      if (bId.includes("\0")) continue;
      if (foundBoundaryIds.includes(bId)) continue;
      for (const locale of this.locales) {
        const catPath = this.catalog.getCatalogPath(bId, locale);
        if (catPath && this.io.getNormalizedId(catPath) === this.io.getNormalizedId(filePath)) {
          foundBoundaryIds.push(bId);
          this.messages.dirtyBoundaries.add(bId);
          break;
        }
      }
    }

    // 3. Check if it's an HTML catalog file
    for (const bId of Object.keys(this.messages.metadataGraph)) {
      if (!this.messages.metadataGraph[bId].htmlProjection) continue;
      if (foundBoundaryIds.includes(bId)) continue;
      for (const locale of this.locales) {
        const catPath = this.html.getCatalogPath(bId, locale);
        if (catPath && this.io.getNormalizedId(catPath) === this.io.getNormalizedId(filePath)) {
          foundBoundaryIds.push(bId);
          this.messages.dirtyBoundaries.add(bId);
          break;
        }
      }
    }

    for (const bId of foundBoundaryIds) {
      delete this.catalog.getCache()[bId];
      this.boundaryRevisions.set(bId, (this.boundaryRevisions.get(bId) || 0) + 1);
    }
    if (foundBoundaryIds.length === 0 && filePath.endsWith(".json")) {
      this.catalog.setCache({});
    }
    return foundBoundaryIds;
  }

  private isReachable(fromId: string, toId: string, visited = new Set<string>()): boolean {
    if (fromId === toId) return true;
    if (visited.has(fromId)) return false;
    visited.add(fromId);

    const node = this.graph.boundaryGraph?.nodes.get(fromId);
    if (!node) return false;

    if (node.filePath === toId) return true;

    for (const dep of node.deps) {
      if (this.isReachable(dep.id, toId, visited)) {
        return true;
      }
    }
    return false;
  }

  public getAffectedChunks(boundaryId: string): string[] {
    const affected = new Set<string>();
    if (!this.graph.chunkGraph) return [];

    if (boundaryId === "b_assets") {
      for (const [id, chunk] of this.graph.chunkGraph.chunks.entries()) {
        if (chunk.type === "entry") {
          const splitIdx = id.indexOf("_");
          affected.add(`${id.substring(0, splitIdx)}:${id.substring(splitIdx + 1)}`);
        }
      }
    }

    if (this.isDev && this.graph.boundaryGraph) {
      let targetFileId = boundaryId;
      let node = this.graph.boundaryGraph.nodes.get(boundaryId);
      if (!node) {
        for (const [nid, n] of this.graph.boundaryGraph.nodes.entries()) {
          if (this.io.getSafeBoundaryId(nid) === boundaryId) {
            node = n;
            break;
          }
        }
      }
      if (node && node.filePath) {
        targetFileId = node.filePath;
      }
      const entryPoints = this.graph.boundaryGraph.entries;
      for (const entryId of entryPoints) {
        if (this.isReachable(entryId, targetFileId)) {
          const safeEntryId = this.io.getSafeBoundaryId(entryId);
          affected.add(`entry:${safeEntryId}`);
        }
      }
    }

    for (const chunk of this.graph.chunkGraph.chunks.values()) {
      let isAffected = chunk.boundaries.has(boundaryId) || chunk.colonies.has(boundaryId);

      if (!isAffected) {
        for (const bId of [...chunk.boundaries, ...chunk.colonies]) {
          if (bId.startsWith(boundaryId + ":")) {
            isAffected = true;
            break;
          }
        }
      }

      if (!isAffected) {
        for (const cId of chunk.colonies) {
          if (boundaryId.startsWith(cId + ":")) {
            isAffected = true;
            break;
          }
        }
      }

      if (isAffected) {
        const splitIdx = chunk.id.indexOf("_");
        affected.add(`${chunk.id.substring(0, splitIdx)}:${chunk.id.substring(splitIdx + 1)}`);
      }
    }

    const safeId = this.io.getSafeBoundaryId(boundaryId);
    affected.add(`boundary:${safeId}`);
    affected.add(`lazy:${safeId}`);

    return Array.from(affected);
  }

  public async discover(dir: string = this.root) {
    this.discoveryPhase = true;
    this.logger.debug(`Discovering source files in ${dir}...`);

    const absoluteOutputDir = isAbsolute(this.catalog.outputDir)
      ? this.catalog.outputDir
      : join(this.root, this.catalog.outputDir);
    const normalizedOutputDir = absoluteOutputDir.replace(/\\/g, "/");

    const doDisc = async (d: string) => {
      const entries = await this.io.readEntries(d);
      const tasks: Promise<void>[] = [];
      for (const entry of entries) {
        const fullPath = join(d, entry.name);
        const normalizedFullPath = fullPath.replace(/\\/g, "/");
        if (
          normalizedFullPath === normalizedOutputDir ||
          normalizedFullPath.startsWith(normalizedOutputDir + "/")
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist")
            continue;
          tasks.push(doDisc(fullPath));
        } else if (this.extensions.some((ext) => entry.name.endsWith(ext))) {
          tasks.push(
            (async () => {
              const code = await this.io.readFile(fullPath);
              await this.transform(code, fullPath, undefined, true);
            })(),
          );
        } else if (this.assets.isSupportedAsset(fullPath)) {
          // Register for watch tracking; actual localized writes are gated
          // inside syncSingleAsset() by the anchor-reachability check.
          tasks.push(this.assets.registerAsset(fullPath));
        }
      }
      await Promise.all(tasks);
    };

    try {
      await doDisc(dir);
    } finally {
      this.discoveryPhase = false;
    }
    await this.syncGraphs();
  }

  public flushCache() {
    this.hashCache = {};
    this.catalog.setCache({});
    this.messages.dirtyBoundaries.clear();
  }

  public async syncGraphs(force = false) {
    if (force) this.graphDirty = true;
    if (!this.graphDirty && this.rebuildPromise) return this.rebuildPromise;
    this.graphDirty = false;
    this.reachableCache = null;
    this.rebuildPromise = (async () => {
      // In dev mode, we add a special shared boundary for assets
      if (this.isDev) {
        const assetTranslations = await this.assets.getAssetTranslations(this.sourceLocale);
        const assetKeys = Object.keys(assetTranslations).map((text) => ({
          text,
          id: "asset",
          boundaryId: "b_assets",
        }));
        this.messages.internalManifest["b_assets"] = assetKeys as any;

        if (!this.messages.metadataGraph["b_assets"]) {
          this.messages.metadataGraph["b_assets"] = {
            isEntry: false,
            needsLoader: false,
            anchorSites: [],
            internalDependencies: [],
            exportedBoundaries: [],
          };
        }

        for (const loc of this.locales) {
          const locAssets = await this.assets.getAssetTranslations(loc);
          if (!this.messages.hive[loc]) this.messages.hive[loc] = {};

          let changed = false;
          for (const [k, v] of Object.entries(locAssets)) {
            if (this.messages.hive[loc][k] !== v) {
              this.messages.hive[loc][k] = v;
              changed = true;
            }
          }
          if (changed) {
            this.messages.markHiveDirty();
          }
        }
      }

      this.logger.debug(
        `Building boundary graph with ${Object.keys(this.messages.internalManifest).length} nodes`,
      );
      const g = this.graph.buildBoundaryGraph(
        this.messages.internalManifest,
        this.messages.metadataGraph,
        this.messages.dependencyGraph,
      );
      this.graph.propagateActiveLocales(g);
      const c = this.graph.computeTranslationChunks(
        g,
        this.messages.internalManifest,
        this.messages.metadataGraph,
      );
      this.graph.boundaryGraph = g;
      this.graph.chunkGraph = c;
      return;
    })();
    return this.rebuildPromise;
  }

  /**
   * Transforms an HTML file by applying localized projections (title, description, dir).
   * Depending on the owner anchor tier, it either bakes values or injects a bootstrap script.
   */
  public async transformHtml(
    html: string,
    id: string,
    preloads?: Record<string, string[]>,
  ): Promise<string> {
    let fileId = this.io.getNormalizedId(id);
    let fannedLocale: string | undefined;

    // Normalize fanned directory requests (e.g. "en" or "en/") to "en/index.html"
    const dirParts = fileId.split("/");
    if (dirParts.length === 1 && this.locales.includes(dirParts[0])) {
      fileId = `${dirParts[0]}/index.html`;
    } else if (dirParts.length > 1 && this.locales.includes(dirParts[dirParts.length - 1])) {
      fileId = `${fileId}/index.html`;
    }

    const physicalPath = join(this.root, fileId);
    if (await this.io.exists(physicalPath)) {
      const stats = await this.io.stat(physicalPath);
      if (stats.isDirectory()) {
        return html;
      }
    }

    if (fileId.endsWith(".html")) {
      const parts = fileId.split("/");
      for (const loc of this.locales) {
        if (parts.includes(loc) || fileId.includes(`:${loc}`) || fileId.includes(`/${loc}`)) {
          fannedLocale = loc;
          break;
        }
      }
      if (fannedLocale) {
        const filteredParts = parts.filter((p) => p !== fannedLocale);
        fileId = filteredParts.join("/");
      }
    }

    let meta = this.metadataGraph[fileId];

    if (!meta || this.isDev) {
      this.logger.debug(`Refreshing HTML metadata: ${fileId}`);
      let sourceHtml = html;
      let sourcePath = id;

      const physicalPath = join(this.root, fileId);
      if (await this.io.exists(physicalPath)) {
        sourceHtml = await this.io.readFile(physicalPath);
        sourcePath = physicalPath;
      }

      await this.transform(sourceHtml, sourcePath, undefined, true);
      meta = this.metadataGraph[fileId];
    }

    if (!meta || !meta.htmlProjection) return html;

    // 1. Identify the "Winning" owner script by tracing the tree
    let winningCheck: { leads: boolean; dynamic: boolean; bakedLocale?: string } | undefined;

    const scripts = meta.htmlProjection.scripts;
    for (const script of scripts) {
      let scriptRel = script;
      if (scriptRel.startsWith("/")) scriptRel = scriptRel.substring(1);
      const scriptPath = join(this.root, scriptRel);
      const scriptId = this.io.getNormalizedId(scriptPath);

      if (!this.messages.metadataGraph[scriptId]) {
        if (await this.io.exists(scriptPath)) {
          this.logger.debug(`JIT extraction for script: ${scriptId}`);
          try {
            const scriptCode = await this.io.readFile(scriptPath);
            await this.transform(scriptCode, scriptPath, undefined, true);
          } catch {}
        }
      }

      const check = this.graph.leadsToBoundary(
        scriptId,
        this.messages.dependencyGraph,
        this.messages.metadataGraph,
      );

      if (check.leads) {
        if (!winningCheck || (check.dynamic && !winningCheck.dynamic)) {
          winningCheck = check;
        }
      }
    }

    if (!winningCheck) return html;

    // 2. Determine base projection values
    const isLiteral = !winningCheck.dynamic;
    const targetLocale =
      (isLiteral && fannedLocale) ||
      (isLiteral ? winningCheck.bakedLocale || this.sourceLocale : this.sourceLocale);

    if (targetLocale === "*") {
      const existingRedirectRe = /<script id="zintl-sovereign-redirect">[\s\S]*?<\/script>/gi;
      const cleanedHtml = html.replace(existingRedirectRe, "");

      const localesStr = JSON.stringify(this.locales);
      const defaultLocale = this.sourceLocale || "en";
      const redirectScript = `<script id="zintl-sovereign-redirect">
      (function() {
        const lang = (navigator.language || '${defaultLocale}').split('-')[0];
        const supported = ${localesStr};
        const target = supported.includes(lang) ? lang : '${defaultLocale}';
        window.location.replace('/' + target + '/');
      })();
    </script>`;

      if (cleanedHtml.includes("</head>")) {
        return cleanedHtml.replace(/<\/head>/i, `  ${redirectScript}\n  </head>`);
      }
      return `<head>\n  ${redirectScript}\n</head>\n${cleanedHtml}`;
    }

    let title = meta.htmlProjection.title;
    let description = meta.htmlProjection.description;
    let dir = meta.htmlProjection.dir;
    if (isLiteral && !dir) {
      dir = ["ar", "he", "iw", "fa", "ur", "yi"].includes(targetLocale) ? "rtl" : "ltr";
    }

    if (isLiteral && targetLocale !== "none") {
      const catalogPath = this.html.getCatalogPath(fileId, targetLocale);
      if (await this.io.exists(catalogPath)) {
        try {
          const catalog = JSON.parse(await this.io.readFile(catalogPath));
          const catalogTitle = this.isMultilingualFormat()
            ? catalog.title?.[targetLocale]
            : catalog.title;
          const catalogDesc = this.isMultilingualFormat()
            ? catalog.description?.[targetLocale]
            : catalog.description;
          const catalogDir = this.isMultilingualFormat()
            ? catalog.dir?.[targetLocale]
            : catalog.dir;

          title = catalogTitle !== undefined ? catalogTitle : title;
          description = catalogDesc !== undefined ? catalogDesc : description;
          dir = catalogDir !== undefined ? catalogDir : dir;
        } catch {}
      }
    }

    // console.log("[Zintl Debug] transformHtml:", {
    //   fileId,
    //   id,
    //   fannedLocale,
    //   isLiteral,
    //   targetLocale,
    //   dir,
    // });

    // 3. Apply Projection
    let mutated = html;
    mutated = mutated.replace(/<html([^>]*)>/i, (m, attrs) => {
      let newAttrs = attrs;
      if (!/lang=/i.test(attrs)) newAttrs += ` lang="${targetLocale}"`;
      else newAttrs = newAttrs.replace(/lang=["'][^"']*["']/i, `lang="${targetLocale}"`);

      if (dir) {
        if (!/dir=/i.test(attrs)) newAttrs += ` dir="${dir}"`;
        else newAttrs = newAttrs.replace(/dir=["'][^"']*["']/i, `dir="${dir}"`);
      } else {
        newAttrs = newAttrs.replace(/\s*dir=["'][^"']*["']/i, "");
      }

      return `<html${newAttrs}>`;
    });

    if (title) {
      mutated = mutated.replace(/<title[^>]*>([\s\S]*?)<\/title>/i, `<title>${title}</title>`);
    }
    if (description) {
      mutated = mutated.replace(
        /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
        `<meta name="description" content="${description}">`,
      );
      mutated = mutated.replace(
        /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
        `<meta name="description" content="${description}">`,
      );
    }

    // 4. Inject Bootstrap for Dynamic Anchors
    if (!isLiteral) {
      const existingRe =
        /<!--zintl-bootstrap-->\s*<script id="zintl-projection">[\s\S]*?<\/script>/gi;
      mutated = mutated.replace(existingRe, "");

      let winningDetection: string | undefined;
      let winningVar: string | undefined;

      for (const script of scripts) {
        let scriptRel = script;
        if (scriptRel.startsWith("/")) scriptRel = scriptRel.substring(1);
        const scriptId = scriptRel.replace(/\.[^/.]+$/, "");
        const scriptMeta = this.messages.metadataGraph[scriptId];
        if (scriptMeta?.anchorSites) {
          const dynamicAnchor = scriptMeta.anchorSites.find((a: any) => a.detectionCode);
          if (dynamicAnchor) {
            winningDetection = dynamicAnchor.detectionCode;
            winningVar =
              dynamicAnchor.locale.type === "expression" ? dynamicAnchor.locale.source : undefined;
            break;
          }
        }
      }

      const rtlLocales: string[] = [];
      const deltas: Record<string, any> = {};

      const isMultilingual = this.isMultilingualFormat();
      let multiCatalog: any;
      if (isMultilingual) {
        const catalogPath = this.html.getCatalogPath(fileId, this.locales[0]);
        if (await this.io.exists(catalogPath)) {
          try {
            multiCatalog = JSON.parse(await this.io.readFile(catalogPath));
          } catch {}
        }
      }

      for (const locale of this.locales) {
        const catalogPath = isMultilingual ? "" : this.html.getCatalogPath(fileId, locale);
        if (multiCatalog || (catalogPath && (await this.io.exists(catalogPath)))) {
          try {
            const catalog = multiCatalog || JSON.parse(await this.io.readFile(catalogPath));
            const catalogDir = isMultilingual ? catalog.dir?.[locale] : catalog.dir;
            const catalogTitle = isMultilingual ? catalog.title?.[locale] : catalog.title;
            const catalogDesc = isMultilingual
              ? catalog.description?.[locale]
              : catalog.description;

            if (catalogDir === "rtl") rtlLocales.push(locale);
            else if (locale === this.sourceLocale && dir === "rtl") rtlLocales.push(locale);

            if (locale !== this.sourceLocale) {
              const delta: Record<string, string> = {};
              if (title && catalogTitle?.trim() && catalogTitle !== meta.htmlProjection.title) {
                delta.title = catalogTitle;
              }
              if (
                description &&
                catalogDesc?.trim() &&
                catalogDesc !== meta.htmlProjection.description
              ) {
                delta.description = catalogDesc;
              }
              if (Object.keys(delta).length > 0) deltas[locale] = delta;
            }
          } catch {}
        } else if (locale === this.sourceLocale && dir === "rtl") {
          rtlLocales.push(locale);
        }
      }

      const hasDeltas = Object.keys(deltas).length > 0;
      const hasPreloads = Object.keys(preloads || {}).length > 0;
      const hasRtl = rtlLocales.length > 0;

      // build
      const rtlChunk = hasRtl ? `const rtl = ${JSON.stringify(rtlLocales)};` : "";

      const deltasChunk = hasDeltas ? `const deltas = ${JSON.stringify(deltas)};` : "";
      const preloadsChunk = hasPreloads
        ? `const preloads = ${JSON.stringify(preloads)};
        function preload(locale) {
          const urls = preloads[locale] || [];
          for (const url of urls) {
            const link = document.createElement("link");
            link.rel = "modulepreload";
            link.href = url;
            document.head.appendChild(link);
          }
        }`
        : "";

      const originalsChunk =
        title || description
          ? `
        const originals = {
          ${title ? "title: document.title," : ""}
          ${description ? `description: document.querySelector('meta[name="description"]')?.content,` : ""}
        };`
          : "";

      const applyChunk = hasDeltas
        ? `
          const hasText = v => typeof v === "string" && v.trim();

          ${description ? `const meta = document.querySelector('meta[name="description"]');` : ""}
          const delta = deltas[locale];

          if (delta) {
            ${
              title
                ? `
            document.title = hasText(delta.title)
              ? delta.title
              : originals.title;`
                : ""
            }

            ${
              description
                ? `
                if (meta && originals.description !== undefined) {
                  meta.content = hasText(delta.description)
                    ? delta.description
                    : originals.description;
                }`
                : ""
            }
          } else {
            ${title ? "document.title = originals.title;" : ""}
            ${
              description
                ? "if (meta && originals.description !== undefined) meta.content = originals.description;"
                : ""
            }
          }`
        : "";

      const dirChunk = hasRtl
        ? `document.documentElement.dir = rtl.includes(locale) ? 'rtl' : 'ltr';`
        : "";

      const bootstrap = `<!--zintl-bootstrap-->
    <script id="zintl-projection">
      (function() {
        ${winningDetection ? winningDetection.replace(/\n/g, "\n        ") + "\n        " : ""}
        const l = ${winningDetection ? winningVar + " || " : ""}localStorage.getItem('zintl-locale') || '${this.sourceLocale}';
        ${rtlChunk}
        ${deltasChunk}
        ${originalsChunk}
        ${preloadsChunk}

        function apply(locale) {
          if (document.documentElement.lang === locale) return;

          ${dirChunk}
          document.documentElement.lang = locale;

          ${applyChunk}
        }

        window.__zintlApplyHtml = apply;

        if (l !== '${this.sourceLocale}') {
          apply(l);
          ${hasPreloads ? "preload(l);" : ""}
        }
      })();
    </script>`
        .replace(/\n\s*\n+/g, "\n")
        .trim();
      // check if the mutated has </title>
      // thats not going to works for descrption orginal too!
      // lets place it before `<script type="module".../>` or `<script type="module" src="/"...></script>`
      const scriptRe = /<script\s+[^>]*type="module"[^>]*src="\/"[^>]*>\s*<\/script>/i;
      const match = mutated.match(scriptRe);
      if (match) {
        mutated = mutated.replace(match[0], bootstrap + "\n    " + match[0]);
      } else {
        mutated = mutated.replace(/<\/head>/i, `${bootstrap}\n  </head>`);
      }
    }

    return mutated;
  }

  async transform(
    code: string,
    id: string,
    _virtualInjectionTarget?: string,
    onlyExtract = false,
    multiplexLocale?: string,
    ssr?: boolean,
  ): Promise<{ code: string; map: any } | undefined> {
    const isTargetSsrEntry = this.isSsrEntryTarget(id);
    if (id.includes("node_modules") || (id.startsWith("\0") && !isTargetSsrEntry)) return;
    code = code.replace(/\r\n/g, "\n");
    if (code.includes('id="zintl-multiplex-redirect"')) return;
    const multiplexMatch = id.match(/[?&]zintl-multiplex=([^&]+)/);
    const effectiveMultiplexLocale =
      multiplexLocale || (multiplexMatch ? multiplexMatch[1] : undefined);
    const cleanId = id.split("?")[0];
    let fileId = this.io.getNormalizedId(cleanId);
    let effectiveCleanId = cleanId;

    let isFannedHtml = false;
    // Detect and redirect fanned HTML files to their original physical file
    for (const loc of this.locales) {
      const prefixProd = loc + "/";
      const prefixDev = this.resolveVirtualPath(`virtual:zintl-multiplex-html:${loc}/`);
      const prefixDevBare = this.resolveVirtualPath(`virtual:zintl-multiplex-html:${loc}`);

      if (fileId.startsWith(prefixProd) && fileId.endsWith(".html")) {
        const relativeHtml = fileId.substring(prefixProd.length);
        fileId = relativeHtml;
        effectiveCleanId = join(this.root, relativeHtml);
        isFannedHtml = true;
        break;
      } else if (fileId.startsWith(prefixDev) && fileId.endsWith(".html")) {
        const relativeHtml = fileId.substring(prefixDev.length);
        fileId = relativeHtml;
        effectiveCleanId = join(this.root, relativeHtml);
        isFannedHtml = true;
        break;
      } else if (fileId === prefixDevBare) {
        fileId = "index.html";
        effectiveCleanId = join(this.root, "index.html");
        isFannedHtml = true;
        break;
      }
    }

    let codeToUse = code;
    if (
      fileId === "index.html" ||
      isFannedHtml ||
      effectiveMultiplexLocale !== undefined ||
      id.includes("?")
    ) {
      const physicalPath = isAbsolute(effectiveCleanId)
        ? effectiveCleanId
        : join(this.root, effectiveCleanId);
      if (existsSync(physicalPath)) {
        codeToUse = readFileSync(physicalPath, "utf-8").replace(/\r\n/g, "\n");
        effectiveCleanId = physicalPath;
        code = codeToUse;
      }
    }

    const fileHash = sha1(codeToUse);
    const oldHash = this.hashCache[effectiveCleanId];

    let observation = this.observationCache[effectiveCleanId];

    const shouldObserve =
      !observation || (effectiveMultiplexLocale === undefined && oldHash !== fileHash);

    if (shouldObserve) {
      this.graphDirty = true;
      this.hashCache[effectiveCleanId] = fileHash;

      if (!isTargetSsrEntry && !this.extensions.some((ext) => effectiveCleanId.endsWith(ext)))
        return;

      if (isTargetSsrEntry) {
        observation = {
          fileId,
          hasZintlMarker: false,
          hasZintlMacro: false,
          anchors: [],
          sinks: [],
          manualTranslations: [],
          dependencies: [],
          internalDependencies: [],
          exportedBoundaries: [],
        };
        this.observationCache[effectiveCleanId] = observation;
        this.messages.dependencyGraph[fileId] = [];
        this.messages.metadataGraph[fileId] = {
          hasZintlMarker: false,
          hasZintlMacro: false,
          isEntry: true,
          anchorSites: [],
          needsLoader: false,
          exportedBoundaries: [],
          internalDependencies: [],
          htmlProjection: undefined,
        };
        this.messages.trackBoundaryChange(fileId, new Set([fileId]));
        this.messages.internalManifest[fileId] = [];
      } else {
        observation = observe(
          codeToUse,
          effectiveCleanId,
          fileId,
          this.logger.withPrefix("Extractor"),
          { targets: this._options.targets },
        );
        this.observationCache[effectiveCleanId] = observation;

        this.messages.dependencyGraph[fileId] = observation.dependencies;
        this.messages.metadataGraph[fileId] = {
          hasZintlMarker: observation.hasZintlMarker,
          hasZintlMacro: observation.hasZintlMacro,
          isEntry: observation.hasZintlMarker || observation.anchors.length > 0,
          anchorSites: observation.anchors,
          needsLoader: observation.sinks.length > 0 || observation.manualTranslations.length > 0,
          exportedBoundaries: observation.exportedBoundaries,
          internalDependencies: observation.internalDependencies,
          htmlProjection: observation.htmlProjection,
        };

        const messagesByBoundary: Record<string, any[]> = {};
        const processMsg = (msg: any) => {
          if (!messagesByBoundary[msg.boundaryId]) messagesByBoundary[msg.boundaryId] = [];
          messagesByBoundary[msg.boundaryId].push({
            id: generateMessageId(msg.text),
            text: msg.text,
            boundaryId: msg.boundaryId,
            location: msg.location,
            note: msg.note,
            variables: [
              ...new Set([
                ...(msg.variables?.map((v: any) => v.name) || []),
                ...Object.keys(msg.passVars || {}),
              ]),
            ],
          });
        };
        observation.sinks.forEach(processMsg);
        observation.manualTranslations.forEach((m: any) =>
          processMsg({ text: m.key, boundaryId: m.boundaryId }),
        );

        const trackedBoundaries = new Set(Object.keys(messagesByBoundary));
        observation.anchors.forEach((a: any) => trackedBoundaries.add(a.boundaryId));
        if (
          this.messages.metadataGraph[fileId].isEntry ||
          this.messages.metadataGraph[fileId].htmlProjection
        )
          trackedBoundaries.add(fileId);
        this.messages.trackBoundaryChange(fileId, trackedBoundaries);

        for (const bId of trackedBoundaries) {
          this.messages.internalManifest[bId] = messagesByBoundary[bId] || [];
        }
      }
    }

    if (!onlyExtract && observation) {
      const bIds = new Set<string>();
      observation.sinks.forEach((s: any) => bIds.add(s.boundaryId || fileId));
      observation.manualTranslations.forEach((m: any) => bIds.add(m.boundaryId || fileId));
      observation.anchors.forEach((a: any) => bIds.add(a.boundaryId));
      const meta = this.messages.metadataGraph[fileId];
      if (meta && (meta.isEntry || meta.htmlProjection)) {
        bIds.add(fileId);
      }
      for (const bId of bIds) {
        if (ssr) {
          this.ssrBoundaries.add(bId);
        } else {
          this.clientBoundaries.add(bId);
        }
      }
    }

    if (!this.discoveryPhase && this.graphDirty) {
      await this.syncGraphs();
      this.messages.reconcile();
    }

    const needsTransform =
      observation.anchors.length > 0 ||
      observation.sinks.length > 0 ||
      observation.manualTranslations.length > 0 ||
      observation.hasZintlMarker ||
      observation.hasZintlMacro ||
      isTargetSsrEntry;

    if (!needsTransform && !onlyExtract) return;

    if (!onlyExtract) {
      let isZintlizing = true;
      if (this.graph.boundaryGraph) {
        const isTestEnv =
          typeof process !== "undefined" &&
          (process.env.NODE_ENV === "test" || !!process.env.VITEST);
        const isExample = cleanId.replace(/\\/g, "/").includes("/examples/");
        if (this.graph.boundaryGraph.entries.size === 0) {
          isZintlizing = isTestEnv && !isExample;
        } else {
          isZintlizing = true;
        }
      }
      if (!isZintlizing) {
        return;
      }
    }

    if (onlyExtract) return;

    // Clone observation to avoid mutating the cached pristine copy
    const activeObservation = {
      ...observation,
      anchors: observation.anchors.map((a: any) => ({
        ...a,
        locale: { ...a.locale },
      })),
      sinks: observation.sinks.map((s: any) => ({ ...s })),
      manualTranslations: observation.manualTranslations.map((m: any) => ({ ...m })),
    };

    if (effectiveMultiplexLocale) {
      for (const anchor of activeObservation.anchors) {
        const isContextual =
          anchor.locale.type === "none" ||
          (anchor.locale.type === "expression" && !anchor.locale.source) ||
          (anchor.locale.type === "literal" && anchor.locale.value === "none");
        const isSovereign = anchor.locale.type === "literal" && anchor.locale.value === "*";

        if (isContextual || isSovereign) {
          anchor.locale = {
            type: "literal",
            value: effectiveMultiplexLocale,
          };
        }
      }
    }

    let bakedLocale: string | undefined;
    if (effectiveMultiplexLocale) {
      bakedLocale = effectiveMultiplexLocale;
    } else if (!this.isDev && this._options.multiplex !== false && !ssr) {
      if (activeObservation.anchors.length > 0) {
        let common: string | undefined,
          dynamic = false,
          mismatch = false;
        for (const a of activeObservation.anchors) {
          if (a.locale.type === "expression") {
            dynamic = true;
            break;
          }
          const val = a.locale.type === "literal" ? a.locale.value : this.sourceLocale;
          if (common === undefined) common = val;
          else if (common !== val) {
            mismatch = true;
            break;
          }
        }
        if (!dynamic && !mismatch) bakedLocale = common || this.sourceLocale;
      } else {
        const dummy = this.createWorldState();
        const ownerId = resolveOwner(activeObservation.fileId, dummy);
        const anchor = findEffectiveAnchor(
          activeObservation.fileId,
          dummy,
          activeObservation,
          ownerId,
        );
        if (anchor) {
          if (anchor.locale.type === "literal") {
            bakedLocale = anchor.locale.value;
          } else if (anchor.locale.type === "none") {
            bakedLocale = this.sourceLocale;
          }
        }
      }
    }

    const catalogs: Record<string, Record<string, any>> = {};
    if (bakedLocale) {
      const relevant = new Set([fileId]);
      activeObservation.sinks.forEach((s: any) => relevant.add(s.boundaryId));
      activeObservation.manualTranslations.forEach((m: any) => relevant.add(m.boundaryId));
      await Promise.all(
        Array.from(relevant).map(async (bId) => {
          catalogs[bId] = await this.catalog.loadUserCatalog(
            bId,
            bakedLocale!,
            this.messages.internalManifest,
            this.isDev,
            this.messages.hive,
            this.messages.currentReconciliation,
          );
        }),
      );
    }

    const world = this.createWorldState(
      catalogs,
      effectiveMultiplexLocale || bakedLocale ? false : undefined,
      bakedLocale,
    );

    // Ensure findEffectiveAnchor uses the current mutated observation for this file
    world.metadataGraph[fileId] = {
      hasZintlMarker: activeObservation.hasZintlMarker,
      hasZintlMacro: activeObservation.hasZintlMacro,
      isEntry: activeObservation.hasZintlMarker || activeObservation.anchors.length > 0,
      anchorSites: activeObservation.anchors,
      needsLoader:
        activeObservation.sinks.length > 0 || activeObservation.manualTranslations.length > 0,
      exportedBoundaries: activeObservation.exportedBoundaries,
      internalDependencies: activeObservation.internalDependencies,
      htmlProjection: activeObservation.htmlProjection,
    };

    const intents = formIntent(activeObservation, world);
    const plan = resolve(
      intents,
      activeObservation,
      world.config,
      this.logger.withPrefix("Pipeline"),
      effectiveCleanId,
    );
    const result = apply(code, plan, this.logger.withPrefix("Pipeline"), id, world.config);
    if (this.isDev) {
      const validation = validate(
        result,
        plan,
        activeObservation,
        this.logger.withPrefix("Pipeline"),
      );
      if (!validation.valid) {
        this.logger.error(`Validation failed for ${id}:`, validation.errors);
      }
    }

    if (this.isDev) this.scheduleFlush();

    let finalCode = result.code;
    let ssrWrapped = false;
    if (ssr && this._options.ssrWrapCode) {
      const wrapped = this._options.ssrWrapCode({
        code: finalCode,
        fileId,
        isEntry: this.isEntry(fileId) || isTargetSsrEntry,
        locales: this.locales,
        sourceLocale: this.sourceLocale,
      });
      if (wrapped !== undefined) {
        finalCode = wrapped;
        ssrWrapped = true;
      }
    }

    if (
      ssr &&
      !ssrWrapped &&
      (this.isEntry(fileId) ||
        isTargetSsrEntry ||
        fileId.endsWith("entry-server") ||
        fileId.endsWith("entry-server.ts") ||
        fileId.endsWith("entry-server.js"))
    ) {
      if (
        !finalCode.includes("_zintl_raw_render") &&
        !finalCode.includes("_zintl_runInRequestScope")
      ) {
        const localesStr = JSON.stringify(this.locales);
        const defaultLocaleStr = JSON.stringify(this.sourceLocale || "en");
        const runtimeInternal = this.resolveVirtualPath("virtual:zintl/runtime/internal");

        // 1. Classic render wrapping
        const funcRegex = /export\s+(async\s+)?function\s+render\b/;
        if (funcRegex.test(finalCode)) {
          finalCode = finalCode.replace(
            /export\s+(async\s+)?function\s+render\b/,
            "async function _zintl_raw_render",
          );
          finalCode += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope(urlOrReq, ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
        } else {
          const exportBlockRegex = /export\s*\{([^}]+)\}/g;
          let match;
          let found = false;
          while ((match = exportBlockRegex.exec(finalCode)) !== null) {
            const content = match[1];
            if (/\brender\b/.test(content)) {
              const parts = content.split(",").map((p) => p.trim());
              const index = parts.findIndex(
                (p) => p === "render" || p.startsWith("render as ") || p.endsWith(" as render"),
              );
              if (index !== -1) {
                const part = parts[index];
                if (part === "render") {
                  parts[index] = "render as _zintl_raw_render";
                  found = true;
                } else if (part.endsWith(" as render")) {
                  const localName = part.substring(0, part.length - " as render".length).trim();
                  parts[index] = `${localName} as _zintl_raw_render`;
                  found = true;
                }
                if (found) {
                  const newBlock = `export { ${parts.join(", ")} }`;
                  finalCode = finalCode.replace(match[0], newBlock);
                  finalCode += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope(urlOrReq, ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
                  break;
                }
              }
            }
          }
        }

        // 2. Generic Default Export Wrapping
        if (this._options.ssrWrapDefault) {
          const defaultExportRegex = /(^|\n)export\s+default\b/;
          if (defaultExportRegex.test(finalCode)) {
            finalCode = finalCode.replace(defaultExportRegex, "$1const _zintl_raw_default = ");
            finalCode += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";\nexport default function _zintl_wrapped_default(urlOrReq, ...args) {\n  return _zintl_runInRequestScope(urlOrReq, ${localesStr}, ${defaultLocaleStr}, () => {\n    if (typeof _zintl_raw_default === "function") return _zintl_raw_default(urlOrReq, ...args);\n    if (_zintl_raw_default && typeof _zintl_raw_default.fetch === "function") return _zintl_raw_default.fetch(urlOrReq, ...args);\n    return _zintl_raw_default;\n  });\n}`;
          }
        }

        // 3. Generic Named Exports Wrapping
        if (this._options.ssrWrapExports && this._options.ssrWrapExports.length > 0) {
          let hasImport = false;
          for (const name of this._options.ssrWrapExports) {
            let wrappedExport = false;

            // Syntax 1: export (async )?function name
            const namedFuncRegex = new RegExp(
              `(^|\\n)export\\s+(async\\s+)?function\\s+${name}\\b`,
            );
            if (namedFuncRegex.test(finalCode)) {
              finalCode = finalCode.replace(namedFuncRegex, `$1async function _zintl_raw_${name}`);
              wrappedExport = true;
            }

            // Syntax 2: export const/let/var name = ...
            if (!wrappedExport) {
              const constRegex = new RegExp(`(^|\\n)export\\s+(const|let|var)\\s+${name}\\b`);
              if (constRegex.test(finalCode)) {
                finalCode = finalCode.replace(constRegex, `$1$2 _zintl_raw_${name}`);
                wrappedExport = true;
              }
            }

            // Syntax 3: export { ... name ... }
            if (!wrappedExport) {
              const exportBlockRegex = /export\s*\{([^}]+)\}/g;
              let match;
              while ((match = exportBlockRegex.exec(finalCode)) !== null) {
                const content = match[1];
                if (new RegExp(`\\b${name}\\b`).test(content)) {
                  const parts = content.split(",").map((p) => p.trim());
                  const index = parts.findIndex(
                    (p) => p === name || p.startsWith(`${name} as `) || p.endsWith(` as ${name}`),
                  );
                  if (index !== -1) {
                    const part = parts[index];
                    if (part === name) {
                      parts[index] = `${name} as _zintl_raw_${name}`;
                      wrappedExport = true;
                    } else if (part.endsWith(` as ${name}`)) {
                      const localName = part
                        .substring(0, part.length - ` as ${name}`.length)
                        .trim();
                      parts[index] = `${localName} as _zintl_raw_${name}`;
                      wrappedExport = true;
                    }
                    if (wrappedExport) {
                      const newBlock = `export { ${parts.join(", ")} }`;
                      finalCode = finalCode.replace(match[0], newBlock);
                      break;
                    }
                  }
                }
              }
            }

            if (wrappedExport) {
              if (!hasImport) {
                finalCode += `\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";`;
                hasImport = true;
              }
              finalCode += `\nexport async function ${name}(urlOrReq, ...args) {\n  return _zintl_runInRequestScope(urlOrReq, ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_${name}(urlOrReq, ...args));\n}`;
            }
          }
        }
      }
    }

    if (this.isDev) {
      if (this._options.hmrInjectionCode) {
        let hmrToken = 0;
        const fileBoundaries = (this.messages as any).boundaryOwnership.get(fileId);
        if (fileBoundaries) {
          for (const bId of fileBoundaries) {
            hmrToken += this.boundaryRevisions.get(bId) || 0;
          }
        }
        const hmrCode = this._options.hmrInjectionCode(fileId, hmrToken);
        if (hmrCode) {
          const scriptCloseIdx = finalCode.lastIndexOf("</script>");
          if (scriptCloseIdx !== -1) {
            finalCode =
              finalCode.substring(0, scriptCloseIdx) +
              hmrCode +
              "\n" +
              finalCode.substring(scriptCloseIdx);
          } else {
            finalCode += hmrCode;
          }
        }
      } else {
        if (this.messages.metadataGraph[fileId].anchorSites.length > 0) {
          const hmrCode = `\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    console.debug("[Zintl] HMR update accepted for: ${fileId}");\n  });\n}`;
          const scriptCloseIdx = finalCode.lastIndexOf("</script>");
          if (scriptCloseIdx !== -1) {
            finalCode =
              finalCode.substring(0, scriptCloseIdx) +
              hmrCode +
              "\n" +
              finalCode.substring(scriptCloseIdx);
          } else {
            finalCode += hmrCode;
          }
        }

        let hmrToken = 0;
        const fileBoundaries = (this.messages as any).boundaryOwnership.get(fileId);
        if (fileBoundaries) {
          for (const bId of fileBoundaries) {
            hmrToken += this.boundaryRevisions.get(bId) || 0;
          }
        }
        if (hmrToken > 0) {
          const tokenCode = `\n\n// Zintl HMR Token: ${hmrToken}`;
          const scriptCloseIdx = finalCode.lastIndexOf("</script>");
          if (scriptCloseIdx !== -1) {
            finalCode =
              finalCode.substring(0, scriptCloseIdx) +
              tokenCode +
              "\n" +
              finalCode.substring(scriptCloseIdx);
          } else {
            finalCode += tokenCode;
          }
        }
      }
    }

    return finalCode !== code ? { code: finalCode, map: result.map } : undefined;
  }

  private scheduleFlush() {
    if (this.autoFlushTimeout) clearTimeout(this.autoFlushTimeout);
    this.autoFlushTimeout = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  public async flush() {
    if (this.autoFlushTimeout) {
      clearTimeout(this.autoFlushTimeout);
      this.autoFlushTimeout = null;
    }
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      this.logger.debug("Flushing compiler state...");
      await this.syncGraphs();

      // Clean up old output directory if it changed
      const lastOut = this.messages.lastOutputDir;
      const resolvePath = (p?: string) => {
        if (!p) return "";
        return isAbsolute(p) ? normalize(p) : join(this.root, p);
      };
      const normalizePath = (p?: string) => {
        if (!p) return "";
        return resolvePath(p).replace(/\\/g, "/").replace(/\/+$/, "");
      };
      if (this.prune && lastOut && normalizePath(lastOut) !== normalizePath(this.outputDir)) {
        const old = resolvePath(lastOut);
        if (await this.io.exists(old)) {
          await this.io.rm(old);
          this.logger.debug(`Cleaned up old output directory: ${lastOut}`);
        }
      }

      const activeAssetPaths = await this.assets.getActiveAssetPaths(this.locales);

      // Compute reachable files ONCE and pass down — avoids DFS traversal per-call in prune/sync.
      if (!this.reachableCache) {
        this.reachableCache =
          this.graph.boundaryGraph && this.graph.boundaryGraph.entries.size > 0
            ? this.catalog.getReachableFiles(
                this.graph.boundaryGraph.entries,
                this.messages.dependencyGraph,
              )
            : null;
      }
      const precomputedReachable = this.reachableCache;

      await this.catalog.pruneOrphanedBoundaries(
        this.graph.boundaryGraph!,
        this.locales,
        this.messages.metadataGraph,
        this.messages.dependencyGraph,
        this.graph,
        activeAssetPaths,
        this.graph.chunkGraph!,
        precomputedReachable,
      );
      const changes = this.messages.reconcile();
      const changeCount =
        Object.keys(changes.renames).length +
        changes.moves.length +
        Object.keys(changes.deletes).length;
      if (changeCount > 0) {
        this.logger.debug(
          `Reconciliation found ${changeCount} changes (renames: ${Object.keys(changes.renames).length}, moves: ${changes.moves.length}, deletes: ${Object.keys(changes.deletes).length})`,
        );
      }

      await this.messages.saveManifest(this.outputDir, this.assets.getRegisteredAssetsRaw());

      const affectedBoundaries = new Set<string>(this.messages.dirtyBoundaries);
      for (const bId of Object.keys(changes.renames)) affectedBoundaries.add(bId);
      for (const move of changes.moves as any[]) {
        affectedBoundaries.add(move.fromBoundary);
        affectedBoundaries.add(move.toBoundary);
      }
      for (const bId of Object.keys(changes.deletes)) affectedBoundaries.add(bId);

      // Invalidate on-disk confirmation for any boundary that is now affected/dirty.
      for (const bId of affectedBoundaries) this.confirmedOnDisk.delete(bId);

      // Auto-recover missing catalog or schema files on disk.
      // Only check boundaries NOT already confirmed (avoids N*M fs.stat calls on every flush).
      if (
        this.graph.boundaryGraph &&
        this.confirmedOnDisk.size !== this.graph.boundaryGraph.nodes.size
      ) {
        for (const bId of this.graph.boundaryGraph.nodes.keys()) {
          // Already confirmed on disk and not touched by this flush cycle — skip.
          if (this.confirmedOnDisk.has(bId)) continue;

          const hasContent = (this.messages.internalManifest[bId] || []).length > 0;
          if (!hasContent) continue;

          let missing = false;

          // Check schema
          const schemaPath = this.catalog.getSchemaPath(bId);
          if (schemaPath && !(await this.io.exists(schemaPath))) {
            missing = true;
          }

          // Check catalogs for all locales (except source locale)
          if (!missing) {
            for (const locale of this.locales) {
              if (locale === this.sourceLocale) continue;
              const catPath = this.catalog.getCatalogPath(bId, locale);
              if (catPath && !(await this.io.exists(catPath))) {
                missing = true;
                break;
              }
            }
          }

          if (missing) {
            affectedBoundaries.add(bId);
          } else {
            // All files present — mark confirmed so future flushes skip the stat.
            this.confirmedOnDisk.add(bId);
          }
        }
      }

      const groups = this.catalog.groupBoundariesByPath(affectedBoundaries, this.locales);
      for (const [path, { locales }] of groups) {
        const allBIds = this.catalog.getAllBoundariesForPath(
          path,
          locales[0],
          this.messages.internalManifest,
        );
        await this.catalog.syncPathCatalogs(
          path,
          locales,
          allBIds,
          this.messages.internalManifest,
          this.messages.hive,
          () => this.messages.markHiveDirty(),
          changes,
          this.messages.metadataGraph,
          this.graph.boundaryGraph!,
          this.graph.chunkGraph!,
          this.messages.dependencyGraph,
          precomputedReachable,
        );
      }
      this.messages.dirtyBoundaries.clear();

      // Sync HTML Projections
      const htmlMetadatas: Record<string, any> = {};
      for (const [id, meta] of Object.entries(this.messages.metadataGraph)) {
        if (!meta.htmlProjection) continue;
        const check = this.graph.leadsToBoundary(
          id,
          this.messages.dependencyGraph,
          this.messages.metadataGraph,
        );
        if (check.leads) {
          htmlMetadatas[id] = meta;
        }
      }
      if (Object.keys(htmlMetadatas).length > 0) {
        await this.html.syncHtmlProjections(htmlMetadatas, this.locales, this.messages.hive, () =>
          this.messages.markHiveDirty(),
        );
      }
      if (this.assets.getRegisteredAssets().length > 0) {
        await this.assets.syncAssets(this.locales);
      }

      await this.verifyIntegrity();
      this.logger.debug("Flush complete");
      this.messages.commitReconciliation();
      this.flushPromise = null;
    })();
    return this.flushPromise;
  }

  private async verifyIntegrity() {
    if (!this._verifyIntegrity) return;
    const bg = this.graph.boundaryGraph;
    const cg = this.graph.chunkGraph;
    if (!bg) return;

    // If the project has no trust anchors at all, there is nothing to verify.
    // Phantom boundaries from aggressive stitching (e.g. a Next.js layout.tsx
    // whose template literals were extracted without any zintl() anchor anywhere)
    // must not cause integrity failures — they are simply unreachable dead weight.
    if (bg.entries.size === 0) return;

    // Pre-compute all boundaries reachable (statically) from every entry point.
    // Only boundaries in this set are subject to integrity checks — a file that
    // has extracted sinks but is NOT in the dependency chain of any anchor is a
    // phantom and should be silently skipped.
    const reachableFromEntry = new Set<string>();
    for (const entryId of bg.entries) {
      const tree = this.graph.getStaticDependencyTree(entryId, bg);
      for (const id of tree) reachableFromEntry.add(id);
    }
    // Also include dynamically-imported boundaries so lazy colonies are covered.
    for (const node of bg.nodes.values()) {
      for (const dep of node.deps) {
        if (dep.dynamic) {
          const tree = this.graph.getStaticDependencyTree(dep.id, bg);
          for (const id of tree) reachableFromEntry.add(id);
        }
      }
    }

    for (const [fileId, meta] of Object.entries(this.messages.metadataGraph)) {
      const fileBoundaries =
        (this.messages as any).boundaryOwnership.get(fileId) ||
        new Set([this.io.getNormalizedId(fileId)]);
      // Only integrity-check boundaries that are genuinely reachable from an anchor.
      const isReachable = Array.from(fileBoundaries).some((b) =>
        reachableFromEntry.has(b as string),
      );

      if (!isReachable) continue;

      for (const anchor of meta.anchorSites) {
        if (anchor.locale.type === "literal") {
          const targetLocale = anchor.locale.value;
          if (targetLocale !== "none" && !this.locales.includes(targetLocale)) {
            throw new Error(
              `[Zintl Integrity Error] Boundary anchor at "${fileId}" targets unsupported locale "${targetLocale}". \n` +
                `Active locales: [${this.locales.join(", ")}]. \n` +
                `Fix: Add "${targetLocale}" to your locales config or update the zintl() call.`,
            );
          }
        }
      }

      if (meta.needsLoader && cg && bg.entries.size > 0) {
        for (const bId of fileBoundaries) {
          const owner = cg.boundaryToOwner.get(bId as string);
          const fileIdOfB = (bId as string).split(":")[0];
          const isChunkRoot = Array.from(cg.chunks.values()).some(
            (c) => c.entrySources.has(bId as string) || c.entrySources.has(fileIdOfB),
          );
          const hasContent = (this.messages.internalManifest[bId as string] || []).length > 0;
          if (
            bg.nodes.has(bId as string) &&
            hasContent &&
            !owner &&
            !bg.entries.has(bId as string) &&
            !isChunkRoot
          ) {
            // DEBUG: trace why owner is missing
            // console.error(`[DEBUG] bId="${bId}" owner=${owner}`);
            // console.error(
            //   `[DEBUG] boundaryToOwner keys: ${Array.from(cg.boundaryToOwner.keys()).join(", ")}`,
            // );
            // console.error(`[DEBUG] bg.entries: ${Array.from(bg.entries).join(", ")}`);
            // console.error(`[DEBUG] bg.nodes has?: ${bg.nodes.has(bId as string)}`);
            this.logger.warn(
              `Boundary "${bId}" in "${fileId}" is detected but has no owner chunk. It may fail to hydrate at runtime.`,
            );
          }
        }
      }

      if (!this.isDev) {
        for (const bId of fileBoundaries) {
          if (bId === "b_assets" || (bId as string).startsWith("b_assets:")) continue;
          if (!bg.nodes.has(bId as string)) continue;
          for (const locale of this.locales) {
            if (locale === this.sourceLocale) continue;

            const catalog = await this.catalog.loadUserCatalog(
              bId as string,
              locale,
              this.internalManifest,
              false,
              this.messages.hive,
            );
            const manifestKeys = this.internalManifest[bId as string] || [];

            for (const msg of manifestKeys) {
              let translation = catalog[msg.text];

              if (translation === undefined || translation === "") {
                translation = this.messages.hive[locale]?.[msg.text];
                if (translation) {
                  this.logger.debug(
                    `[Zintl Healing] Using Hive fallback for key "${msg.text}" in locale "${locale}" (Boundary: ${bId})`,
                  );
                }
              }

              if (translation === undefined || translation === "") {
                throw new Error(
                  `[Zintl Integrity Error] Missing or empty translation for key "${msg.text}" in locale "${locale}".\n` +
                    `Boundary: ${bId}\n` +
                    `File: ${fileId}\n` +
                    `Fix: Add the missing translation for key "${msg.text}" in "${locale}" catalog file:\n` +
                    `    at "${this.catalog.getCatalogPath(bId as string, locale)}"\n`,
                );
              }
            }
          }
        }
      }
    }
  }

  public async getDiagnosticWorldState(): Promise<WorldState> {
    await this.syncGraphs();
    return this.createWorldState();
  }

  public getMessages(boundaryId: string) {
    return this.messages.internalManifest[boundaryId] || [];
  }

  public _buildBoundaryGraph() {
    return this.graph.buildBoundaryGraph(
      this.messages.internalManifest,
      this.messages.metadataGraph,
      this.messages.dependencyGraph,
    );
  }
  public _computeUsageCounts(graph: any) {
    return this.graph.computeUsageCounts(graph);
  }
  public _computeTranslationChunks(graph: any) {
    return this.graph.computeTranslationChunks(
      graph,
      this.messages.internalManifest,
      this.messages.metadataGraph,
    );
  }

  private createWorldState(
    catalogs: Record<string, Record<string, any>> = {},
    isDevOverride?: boolean,
    bakedLocale?: string,
  ): WorldState {
    return {
      manifest: this.messages.internalManifest as any,
      dependencyGraph: this.messages.dependencyGraph,
      metadataGraph: { ...this.messages.metadataGraph },
      boundaryGraph: this.graph.boundaryGraph!,
      chunkGraph: this.graph.chunkGraph!,
      config: {
        isDev: isDevOverride !== undefined ? isDevOverride : this.isDev,
        sourceLocale: this.sourceLocale,
        locales: this.locales,
        root: this.root,
        outputDir: this._outputDir,
        debug: this.debug,
        bakedLocale,
        multiplex: this._options.multiplex ?? true,
        adapters: this._options.adapters,
        extensions: this.extensions,
        resolveVirtualPath: this._options.resolveVirtualPath,
        dynamicImportTemplate: this._options.dynamicImportTemplate,
      },
      catalogs,
      logger: this.logger,
    };
  }

  public async generateManager(id: string, loc: string) {
    const res = await this.generateVirtualModule(id, loc, true);
    return res.code;
  }

  public async generateVirtualModule(id: string, loc?: string, isMgr = false) {
    if (!this.graph.chunkGraph || this.graphDirty) await this.syncGraphs();
    const boundaryGraph = this.graph.boundaryGraph!;
    const chunkGraph = this.graph.chunkGraph!;
    const managerPrefix = this.resolveVirtualPath("virtual:zintl/manager/");
    const isManagerPath = isMgr || id.startsWith(managerPrefix);

    if (loc === undefined && isManagerPath) {
      const parts = id.split("/");
      if (parts.length >= 3 && parts[2] !== "none") {
        loc = parts[2];
      }
    }

    const bId = id.includes(":") ? id.substring(id.lastIndexOf(":") + 1) : id;
    let node = boundaryGraph.nodes.get(bId);
    if (!node) {
      for (const [nid, n] of boundaryGraph.nodes.entries()) {
        if (this.io.getSafeBoundaryId(nid) === bId) {
          node = n;
          break;
        }
      }
    }
    const fileId = node?.filePath || bId.split(":")[0];

    let reachableColonies: string[] = [];
    if (node) {
      const meta = this.messages.metadataGraph[fileId];
      if (meta?.anchorSites) {
        const anchor = meta.anchorSites.find(
          (s: any) => this.io.getSafeBoundaryId(s.boundaryId) === bId,
        );
        if (anchor) {
          const world = this.createWorldState({}, undefined, loc);
          const { colonies } = getReachableHandshake(anchor.boundaryId, world);
          reachableColonies = colonies;
        }
      }
    }

    if (loc && !isManagerPath && !isMgr) {
      const { catalog: cat, imports } = await this.catalog.getCatalogForFullModule(
        id,
        loc,
        boundaryGraph,
        chunkGraph,
        this.messages.internalManifest,
        this.messages.hive,
        this.messages.currentReconciliation,
        false,
        reachableColonies,
        this.assets,
      );
      const importsCode = imports && imports.length > 0 ? imports.join("\n") + "\n" : "";
      const serialized = this.catalog.serializeCatalog(cat, loc, 4, this.logger);
      let code = `${importsCode}const catalog = ${serialized};\n`;
      if (this.isDev) {
        code += `if (typeof globalThis !== "undefined" && globalThis.__zintl_active) {
  globalThis.__zintl_active.addCatalogs({ [${JSON.stringify(loc)}]: catalog });
}\n`;
      }
      code += `export default catalog;`;
      if (this.isDev) {
        code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
      }
      return {
        code,
        watchedFiles: [],
      };
    }

    if (loc === undefined) {
      const meta =
        this.messages.metadataGraph[fileId] ||
        this.messages.metadataGraph[this.io.getNormalizedId(fileId)];
      if (meta && meta.anchorSites.length > 0) {
        for (const site of meta.anchorSites) {
          if (site.locale.type === "literal") {
            loc = site.locale.value;
            break;
          }
        }
      }
    }

    const bakedLoc = loc || this.sourceLocale;

    const { catalog: catData, imports: mgrImports } = await this.catalog.getCatalogForFullModule(
      id,
      bakedLoc,
      boundaryGraph,
      chunkGraph,
      this.messages.internalManifest,
      this.messages.hive,
      this.messages.currentReconciliation,
      true,
      reachableColonies,
      this.assets,
    );

    const isStaticallyLocked =
      node &&
      node.activeLocales !== "all" &&
      node.activeLocales.size === 1 &&
      node.activeLocales.has(bakedLoc);

    const loader = isStaticallyLocked
      ? `() => (${this.catalog.serializeCatalog(catData, bakedLoc, 4, this.logger)})`
      : `(locale) => {
      switch(locale) { 
        case "${bakedLoc}":\n          return ${this.catalog.serializeCatalog(catData, bakedLoc, 4, this.logger)};
        ${this.locales
          .filter((l) => l !== bakedLoc)
          .map((l) => {
            const contentPath = this.resolveVirtualPath(`virtual:zintl/content/${l}/${id}`);
            return `        case "${l}":\n          return ${this.generateDynamicImport(contentPath)}.then(m => m.default);`;
          })
          .join("\n")}
        default: return {};
      }
    }`;
    const mgrImportsCode = mgrImports && mgrImports.length > 0 ? mgrImports.join("\n") + "\n" : "";
    const managerObj = `{ id: "${this.io.getSafeBoundaryId(bId)}", loader: ${loader} }`;
    let code = mgrImportsCode;
    if (this.isDev) {
      code += `export default (() => {
  const manager = ${managerObj};
  if (typeof globalThis !== "undefined" && globalThis.__zintl_active) {
    globalThis.__zintl_active.registerLoader(manager.id, manager.loader);
  }
  return manager;
})();`;
      code += `\nif (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule?.default && typeof globalThis !== "undefined" && globalThis.__zintl_active) {
      globalThis.__zintl_active.registerLoader(newModule.default.id, newModule.default.loader);
    }
  });
}`;
    } else {
      code += `export default ${managerObj};`;
    }
    return {
      code,
      watchedFiles: [],
    };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getRuntimeCode(moduleName: "store" | "resolver" | "registry" | "internal"): string {
  const cleanName = String(moduleName).replace(".mjs", "").replace(".js", "");
  const mjsPath = join(__dirname, "runtime", `${cleanName}.mjs`);
  const path = existsSync(mjsPath) ? mjsPath : join(__dirname, "runtime", `${cleanName}.js`);
  if (!existsSync(path)) {
    throw new Error(`[Zintl] Runtime module not found: ${moduleName} (resolved to ${path})`);
  }
  return readFileSync(path, "utf-8");
}
