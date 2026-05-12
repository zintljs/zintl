import * as Extractor from "@zintl/extractor";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
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
import { type ZintlOptions, type ZintlLogger, type LogLevel } from "./types/index.js";

import { IOManager } from "./managers/IOManager.js";
import { GraphManager } from "./managers/GraphManager.js";
import { CatalogManager } from "./managers/CatalogManager.js";
import { MessageManager } from "./managers/MessageManager.js";
import { HtmlManager } from "./managers/HtmlManager.js";

export { generateMessageId } from "./utils/hashing.js";
export type { ZintlOptions, ZintlLogger, LogLevel };

export class ZintlCompiler {
  private readonly io: IOManager;
  private readonly graph: GraphManager;
  private readonly catalog: CatalogManager;
  private readonly messages: MessageManager;
  public readonly html: HtmlManager;

  private graphDirty = true;

  private readonly sourceLocale: string;
  private readonly locales: string[];
  private readonly root: string;
  private readonly isDev: boolean;
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

  private hashCache: Record<string, any> = {};
  private observationCache: Record<string, any> = {};
  private rebuildPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> | null = null;
  private autoFlushTimeout: NodeJS.Timeout | null = null;
  private discoveryPhase = false;

  constructor(options: ZintlOptions = {}, root: string = process.cwd(), isDev: boolean = false) {
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
    this.graph = new GraphManager(
      this.io,
      root,
      isDev,
      this.logger.withPrefix("Graph"),
      this.locales,
    );
    this.catalog = new CatalogManager(
      this.io,
      root,
      this._outputDir,
      this.sourceLocale,
      isDev,
      options.catalogFormat,
      this.logger.withPrefix("Catalog"),
      this._prune,
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
  }

  public getWorldState(): WorldState {
    return this.createWorldState();
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

    const foundBoundaryIds: string[] = [];

    // 1. Check if it's a source file (boundary ownership)
    const fileId = this.io.getNormalizedId(filePath);
    const boundaries = (this.messages as any).boundaryOwnership.get(fileId);
    if (boundaries) {
      if (
        this.isDev &&
        (filePath.endsWith(".ts") ||
          filePath.endsWith(".tsx") ||
          filePath.endsWith(".js") ||
          filePath.endsWith(".jsx") ||
          filePath.endsWith(".html"))
      ) {
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
    }
    if (foundBoundaryIds.length === 0 && filePath.endsWith(".json")) {
      this.catalog.setCache({});
    }
    return foundBoundaryIds;
  }

  public getAffectedChunks(boundaryId: string): string[] {
    const affected = new Set<string>();
    if (!this.graph.chunkGraph) return [];
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
    const doDisc = async (d: string) => {
      const entries = await this.io.readEntries(d);
      const tasks: Promise<void>[] = [];
      for (const entry of entries) {
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist")
            continue;
          tasks.push(doDisc(fullPath));
        } else if (/\.(ts|tsx|js|jsx|html)$/.test(entry.name)) {
          tasks.push(
            (async () => {
              const code = await this.io.readFile(fullPath);
              await this.transform(code, fullPath, undefined, true);
            })(),
          );
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
    this.rebuildPromise = (async () => {
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

    if (fileId.endsWith(".html") && fileId !== "index.html") {
      const parts = fileId.split("/");
      const last = parts[parts.length - 1];
      if (last === "index.html" || fileId.includes("virtual:zintl-multiplex-html")) {
        for (const loc of this.locales) {
          if (parts.includes(loc) || fileId.includes(`:${loc}`) || fileId.includes(`/${loc}`)) {
            fannedLocale = loc;
            break;
          }
        }
        fileId = "index.html";
      }
    }

    let meta = this.metadataGraph[fileId];

    if (!meta || this.isDev) {
      this.logger.debug(`Refreshing HTML metadata: ${fileId}`);
      let sourceHtml = html;
      let sourcePath = id;

      if (fileId === "index.html") {
        const physicalPath = join(this.root, "index.html");
        if (await this.io.exists(physicalPath)) {
          sourceHtml = await this.io.readFile(physicalPath);
          sourcePath = physicalPath;
        }
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

      if (html.includes("</head>")) {
        return html.replace(/<\/head>/i, `  ${redirectScript}\n  </head>`);
      }
      return `<head>\n  ${redirectScript}\n</head>\n${html}`;
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
      let winningDetection: string | undefined;
      let winningVar: string | undefined;

      for (const script of scripts) {
        let scriptRel = script;
        if (scriptRel.startsWith("/")) scriptRel = scriptRel.substring(1);
        const scriptId = scriptRel.replace(/\.[^/.]+$/, "");
        const meta = this.messages.metadataGraph[scriptId];
        if (meta?.anchorSites) {
          const dynamicAnchor = meta.anchorSites.find((a: any) => a.detectionCode);
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
  ): Promise<{ code: string; map: any } | undefined> {
    if (id.includes("node_modules") || id.startsWith("\0")) return;
    code = code.replace(/\r\n/g, "\n");
    if (code.includes('id="zintl-multiplex-redirect"')) return;
    const multiplexMatch = id.match(/[?&]zintl-multiplex=([^&]+)/);
    const effectiveMultiplexLocale =
      multiplexLocale || (multiplexMatch ? multiplexMatch[1] : undefined);
    const cleanId = id.split("?")[0];
    let fileId = this.io.getNormalizedId(cleanId);
    let effectiveCleanId = cleanId;

    // Detect and redirect fanned HTML files to their original physical file
    for (const loc of this.locales) {
      const prefixProd = loc + "/";
      const prefixDev = `virtual:zintl-multiplex-html:${loc}/`;
      const prefixDevBare = `virtual:zintl-multiplex-html:${loc}`;

      if (fileId.startsWith(prefixProd) && fileId.endsWith(".html")) {
        const relativeHtml = fileId.substring(prefixProd.length);
        fileId = relativeHtml;
        effectiveCleanId = join(this.root, relativeHtml);
        break;
      } else if (fileId.startsWith(prefixDev) && fileId.endsWith(".html")) {
        const relativeHtml = fileId.substring(prefixDev.length);
        fileId = relativeHtml;
        effectiveCleanId = join(this.root, relativeHtml);
        break;
      } else if (fileId === prefixDevBare) {
        fileId = "index.html";
        effectiveCleanId = join(this.root, "index.html");
        break;
      }
    }

    let codeToUse = code;
    if (fileId === "index.html") {
      const physicalPath = join(this.root, "index.html");
      if (existsSync(physicalPath)) {
        codeToUse = readFileSync(physicalPath, "utf-8").replace(/\r\n/g, "\n");
        effectiveCleanId = physicalPath;
      }
    } else if (effectiveMultiplexLocale !== undefined || id.includes("?")) {
      const physicalPath = isAbsolute(cleanId) ? cleanId : join(this.root, cleanId);
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

      if (
        !effectiveCleanId.endsWith(".ts") &&
        !effectiveCleanId.endsWith(".tsx") &&
        !effectiveCleanId.endsWith(".js") &&
        !effectiveCleanId.endsWith(".jsx") &&
        !effectiveCleanId.endsWith(".html")
      )
        return;

      observation = observe(
        codeToUse,
        effectiveCleanId,
        fileId,
        this.logger.withPrefix("Extractor"),
      );
      this.observationCache[effectiveCleanId] = observation;

      this.messages.dependencyGraph[fileId] = observation.dependencies;
      this.messages.metadataGraph[fileId] = {
        hasZintlMarker: observation.hasZintlMarker,
        hasZintlMacro: observation.hasZintlMacro,
        isEntry: observation.hasZintlMarker || observation.anchors.some((a: any) => a.isTopLevel),
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

    if (!this.discoveryPhase && this.graphDirty) {
      await this.syncGraphs();
      this.messages.reconcile();
    }

    const needsTransform =
      observation.anchors.length > 0 ||
      observation.sinks.length > 0 ||
      observation.manualTranslations.length > 0 ||
      observation.hasZintlMarker ||
      observation.hasZintlMacro;

    if (!needsTransform && !onlyExtract) return;

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
    } else if (!this.isDev) {
      if (activeObservation.anchors.length > 0) {
        let common: string | undefined,
          dynamic = false,
          mismatch = false;
        for (const a of activeObservation.anchors) {
          if (a.locale.type === "expression") {
            dynamic = true;
            break;
          }
          if (common === undefined) common = a.locale.value;
          else if (common !== a.locale.value) {
            mismatch = true;
            break;
          }
        }
        if (!dynamic && !mismatch) bakedLocale = common;
      } else {
        const dummy = this.createWorldState();
        const ownerId = resolveOwner(activeObservation.fileId, dummy);
        const anchor = findEffectiveAnchor(
          activeObservation.fileId,
          dummy,
          activeObservation,
          ownerId,
        );
        if (anchor?.locale.type === "literal") bakedLocale = anchor.locale.value;
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
      effectiveMultiplexLocale ? false : undefined,
      effectiveMultiplexLocale,
    );

    // Ensure findEffectiveAnchor uses the current mutated observation for this file
    world.metadataGraph[fileId] = {
      hasZintlMarker: activeObservation.hasZintlMarker,
      hasZintlMacro: activeObservation.hasZintlMacro,
      isEntry:
        activeObservation.hasZintlMarker ||
        activeObservation.anchors.some((a: any) => a.isTopLevel),
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
    );
    const result = apply(code, plan, this.logger.withPrefix("Pipeline"));
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
    return result.code !== code ? { code: result.code, map: result.map } : undefined;
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
      const normalize = (p?: string) => p?.replace(/\/+$/, "") || "";
      if (this.prune && lastOut && normalize(lastOut) !== normalize(this.outputDir)) {
        const old = isAbsolute(lastOut) ? lastOut : join(this.root, lastOut);
        if (await this.io.exists(old)) {
          await this.io.rm(old);
          this.logger.debug(`Cleaned up old output directory: ${lastOut}`);
        }
      }

      await this.syncGraphs();
      await this.catalog.pruneOrphanedBoundaries(
        this.graph.boundaryGraph!,
        this.locales,
        this.messages.metadataGraph,
        this.messages.dependencyGraph,
        this.graph,
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

      await this.messages.saveManifest(this.outputDir);
      // If reconcile moved things, we might need another sync, but usually syncGraphs handles dirtiness
      await this.syncGraphs();

      const affectedBoundaries = new Set<string>(this.messages.dirtyBoundaries);
      for (const bId of Object.keys(changes.renames)) affectedBoundaries.add(bId);
      for (const move of changes.moves as any[]) {
        affectedBoundaries.add(move.fromBoundary);
        affectedBoundaries.add(move.toBoundary);
      }
      for (const bId of Object.keys(changes.deletes)) affectedBoundaries.add(bId);

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
      await this.html.syncHtmlProjections(htmlMetadatas, this.locales, this.messages.hive, () =>
        this.messages.markHiveDirty(),
      );

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

    for (const [fileId, meta] of Object.entries(this.messages.metadataGraph)) {
      const fileBoundaries =
        (this.messages as any).boundaryOwnership.get(fileId) ||
        new Set([this.io.getNormalizedId(fileId)]);
      const isReachable = Array.from(fileBoundaries).some((b) => bg.nodes.has(b as string));

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

      if (meta.needsLoader && cg) {
        for (const bId of fileBoundaries) {
          const owner = cg.boundaryToOwner.get(bId as string);
          const fileIdOfB = (bId as string).split(":")[0];
          const isChunkRoot = Array.from(cg.chunks.values()).some(
            (c) => c.entrySources.has(bId as string) || c.entrySources.has(fileIdOfB),
          );
          if (!owner && !bg.entries.has(bId as string) && !isChunkRoot) {
            this.logger.warn(
              `Boundary "${bId}" in "${fileId}" is detected but has no owner chunk. It may fail to hydrate at runtime.`,
            );
          }
        }
      }

      if (!this.isDev) {
        for (const bId of fileBoundaries) {
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
      metadataGraph: this.messages.metadataGraph,
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
    const isManagerPath = id.startsWith("virtual:zintl/manager/");

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
      const { catalog: cat } = await this.catalog.getCatalogForFullModule(
        id,
        loc,
        boundaryGraph,
        chunkGraph,
        this.messages.internalManifest,
        this.messages.hive,
        this.messages.currentReconciliation,
        false,
        reachableColonies,
      );
      return {
        code: `export default ${this.catalog.serializeCatalog(cat, loc, 4, this.logger)};`,
        watchedFiles: [],
      };
    }

    if (loc === undefined) {
      const meta = this.messages.metadataGraph[fileId];
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

    const { catalog: catData } = await this.catalog.getCatalogForFullModule(
      id,
      bakedLoc,
      boundaryGraph,
      chunkGraph,
      this.messages.internalManifest,
      this.messages.hive,
      this.messages.currentReconciliation,
      true,
      reachableColonies,
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
            return `        case "${l}":\n          return import("virtual:zintl/content/${l}/${id}").then(m => m.default);`;
          })
          .join("\n")}
        default: return {};
      }
    }`;
    return {
      code: `export default { id: "${this.io.getSafeBoundaryId(bId)}", loader: ${loader} };`,
      watchedFiles: [],
    };
  }
}
