import * as Extractor from "@zintljs/extractor";
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
  type CompilerOptions,
  type ZintlLogger,
  type LogLevel,
  type AssetTargetConfig,
  type AssetMergeStrategy,
  type CatalogFormatContext,
  type CompilerCapabilities,
  type CapabilityFlags,
  type CompilerContext,
} from "./types/index.js";

import { IOManager } from "./managers/IOManager.js";
import { GraphManager } from "./managers/GraphManager.js";
import { CatalogManager } from "./managers/CatalogManager.js";
import { MessageManager } from "./managers/MessageManager.js";
import { DeliveryBus } from "./bus/index.js";

export { generateMessageId, sha1 } from "./utils/hashing.js";
export { similarity } from "./reconcile.js";
export { serializeDeterministic, sortObjectKeys, compareStrings } from "./utils/serialization.js";
export { compileExtractionState } from "./capabilities/compile-targets.js";
export type { ExtractionContribution } from "./capabilities/compile-targets.js";
import type { HtmlProjectionPayload } from "@zintljs/extractor";
export type {
  CompilerOptions,
  ZintlLogger,
  LogLevel,
  AssetTargetConfig,
  AssetMergeStrategy,
  CatalogFormatContext,
  HtmlProjectionPayload,
};

// The full capability contract. The host plugin resolves facets into these
// shapes, so it must be able to name every one of them without ever importing
// @zintljs/extractor.
export type * from "./types/capabilities.js";

// Manager types reachable from CompilerContext. Facet authors receive these on
// the context, so they must be nameable from the package root.
export type { IOManager } from "./managers/IOManager.js";
export type { CatalogManager } from "./managers/CatalogManager.js";

// The delivery bus (docs/spec/ZDB.md). Exported because the host plugin owns
// the hot-update seam and the test harness reads the ledger, so both need to
// name these without reaching into the compiler's internals.
export { DeliveryBus, DEFAULT_HISTORY_LIMIT } from "./bus/index.js";
export type { DeliveryBusOptions } from "./bus/index.js";
export type {
  DeliveryChannel,
  DeliveryLedgerEntry,
  DeliveryOutcome,
  Envelope,
  TerminalOutcome,
} from "./types/delivery.js";

export class ZintlCompiler {
  public readonly io: IOManager;
  public readonly graph: GraphManager;
  public readonly catalog: CatalogManager;
  public readonly messages: MessageManager;
  public readonly ssrBoundaries = new Set<string>();
  public readonly clientBoundaries = new Set<string>();

  /** Pre-resolved facet capabilities + hooks. Set in constructor. */
  public readonly _resolved: CompilerCapabilities;

  public get assets(): any {
    const facet = this._resolved?.system.contentFacets.find(
      (a) => a.name === "system-static-assets",
    );
    if (facet && (facet as any).getManagerInstance) {
      return (facet as any).getManagerInstance(this.getCompilerContext());
    }
    return undefined;
  }

  public get html(): any {
    const facet = this._resolved?.system.contentFacets.find(
      (a) => a.name === "system-html-projection",
    );
    if (facet && (facet as any).getManagerInstance) {
      return (facet as any).getManagerInstance(this.getCompilerContext());
    }
    return undefined;
  }

  private graphDirty = true;
  private readonly extensions: string[];

  public readonly sourceLocale: string;
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
    const targets = this._resolved.system.ssrEntryTargets;
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
  /** Monotonic generation for graph rebuilds — see `syncGraphs`. */
  private graphGeneration = 0;
  private flushPromise: Promise<void> | null = null;
  private autoFlushTimeout: NodeJS.Timeout | null = null;
  private discoveryPhase = false;
  /** Boundaries whose catalog/schema files have been confirmed present on disk. Cleared when they become affected/dirty. */
  private readonly confirmedOnDisk = new Set<string>();
  private reachableCache: Set<string> | null = null;

  /**
   * Delivery accounting — see `docs/spec/ZDB.md`.
   *
   * Public because the host plugin owns the hot-update seam and the test harness
   * reads the ledger; both need it without reaching into compiler internals.
   */
  public readonly bus: DeliveryBus;
  /**
   * The in-flight invalidation for each file, and the sequence that owns it.
   *
   * The hot-update hook runs once *per environment* — a client pass, then one
   * for every other environment — so one filesystem change asks the compiler to
   * invalidate the same file two or more times. Holding the first pass's work
   * here lets the later passes join it (Axiom D3) instead of racing it and
   * double-counting the boundary revision.
   */
  private readonly updateCustody = new Map<string, { seq: number; work: Promise<string[]> }>();
  /**
   * Monotonic catalog generation, stamped into every generated content module.
   *
   * The receiver compares it per `<locale>/<boundaryId>` and discards anything
   * older, so a catalog module that arrives after a newer one has already been
   * applied cannot win.
   *
   * Deliberately a single counter bumped only when an invalidation actually
   * found boundaries, rather than one per module generation. A per-generation
   * number would change the emitted text every time a module was rebuilt —
   * including rebuilds of unchanged content — and the bundler would treat each
   * of those as a real change. The predecessor of this counter made a worse
   * version of the same mistake: it *summed* boundary revisions across a file,
   * which is not injective (two boundaries at revision 1 is indistinguishable
   * from one at revision 2) and emitted the total into a source comment that
   * nothing ever read.
   */
  private catalogGeneration = 0;

  public _options: CompilerOptions;

  constructor(options: CompilerOptions, root: string = process.cwd(), isDev: boolean = false) {
    this._options = options;

    // Capabilities arrive fully resolved. The compiler is deliberately
    // logic-less here: it does not select, merge or validate facets, and it has
    // no idea whether it is compiling React, Vue, Svelte or plain HTML.
    this._resolved = options.capabilities;

    this.extensions = this._resolved.system.extensions;
    this.sourceLocale = options.sourceLocale || DEFAULT_SOURCE_LOCALE;
    this.locales = options.locales || DEFAULT_LOCALES;
    this.root = root;
    this.isDev = isDev;
    this.debug = options.debug;
    // Recording is the diagnosis half and is development-only (Axiom D5); the
    // sequence state it needs for ordering is kept either way.
    this.bus = new DeliveryBus({ record: isDev });

    const ZL = (Extractor as any).ZintlLogger;
    this.logger = new ZL({
      level: options.logLevel,
      prefix: "Zintl/Compiler",
      debug: options.debug,
    }) as ZintlLogger;

    this._outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
    this._prune = options.prune ?? true;
    this._verifyIntegrity = options.verifyIntegrity ?? false;
    this.io = new IOManager(
      root,
      isDev,
      this.logger.withPrefix("IO"),
      options,
      this.extensions,
      this._resolved.facets,
    );
    this.io.bus = this.bus;
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
      this._resolved.system.virtualBoundaries,
      this._resolved.system.contentFacets,
      this._resolved.system.getProtectedCatalogKeys,
    );
    this.messages = new MessageManager(
      this.io,
      options.similarityThreshold,
      this.logger.withPrefix("Messages"),
    );
  }

  private getCompilerContext(): CompilerContext {
    return {
      root: this.root,
      outputDir: this._outputDir,
      sourceLocale: this.sourceLocale,
      locales: this.locales,
      isDev: this.isDev,
      io: this.io,
      logger: this.logger,
      catalog: this.catalog,
      bus: this.bus,
      getDependencyGraph: () => this.messages.dependencyGraph,
      getHive: () => this.messages.hive,
      markHiveDirty: () => this.messages.markHiveDirty(),
      getBoundaryGraph: () => this.graph.boundaryGraph,
      getMetadataGraph: () => this.messages.metadataGraph,
      internalManifest: this.messages.internalManifest,
      leadsToBoundary: (startId, depGraph, metaGraph) =>
        this.graph.leadsToBoundary(startId, depGraph, metaGraph),
      transform: (code, id, virtualInjectionTarget, isDev) =>
        this.transform(code, id, virtualInjectionTarget, isDev),
    };
  }

  public getWorldState(): WorldState {
    return this.createWorldState();
  }

  public resolveVirtualPath(id: string): string {
    return this._resolved.system.resolveVirtualPath(id);
  }

  public generateDynamicImport(path: string): string {
    return this._resolved.system.dynamicImportTemplate(path, this.isDev);
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
    const context = this.getCompilerContext();
    for (const facet of this._resolved.system.contentFacets) {
      if (facet.setup) {
        const savedState =
          this.messages.savedContentStates[facet.name || ""] ||
          (facet.name === "system-static-assets" ? this.messages.registeredAssets : undefined);
        await facet.setup(savedState, context);
      }
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

  /**
   * Invalidate a file for one hot-update event, once, however many callers ask.
   *
   * The hot-update hook is invoked once *per environment* — a client pass, then
   * one for each other environment — so a single filesystem change reaches the
   * compiler two or more times with the same event sequence. Each pass still has
   * its own module graph to invalidate, but the compiler-side work must happen
   * once: running it twice bumped the boundary revision twice and let two
   * re-extractions of the same file race each other.
   *
   * `seq` is the bundler's hot-update timestamp, which is already strictly
   * monotonic and never repeats. Adopting it beats minting a parallel clock that
   * would then have to be kept in step with the one the browser already sees on
   * rewritten imports.
   */
  public async invalidateForUpdate(
    filePath: string,
    seq: number,
    force = false,
    content?: string,
  ): Promise<string[]> {
    const subject = this.io.getNormalizedId(filePath);
    const envelope = this.bus.mint("build/hmr", subject, { seq });

    const held = this.updateCustody.get(subject);
    if (held && held.seq === seq) {
      /**
       * Axiom D3 — another environment reporting the *same* event joins the
       * first pass's custody rather than starting a competing one. The promise
       * is what is shared, not a cached result, because the first pass is
       * usually still running when the second arrives.
       */
      this.bus.settle(envelope, "superseded", "joined the in-flight update for this file");
      return held.work;
    }

    /**
     * Recorded for ordering, but **not** used to discard the work.
     *
     * This is where D1 does not apply, and getting it wrong cost a regression.
     * D1 governs deliveries that *replace* state: a newer catalog makes an older
     * one irrelevant, so discarding the older one loses nothing. Invalidation is
     * not that. It **accumulates** — it marks boundaries dirty, clears caches and
     * re-extracts — and each watcher event may describe a different file state.
     * Dropping an event because a higher sequence was already seen throws away
     * work no later event will redo, and the update it would have produced is
     * simply never emitted.
     *
     * So ordering is enforced downstream, where the delivery really is a
     * replacement: every generated catalog carries `catalogGeneration`, and the
     * runtime discards one that arrives after a newer one. Here the sequence
     * only records, for diagnosis, that events arrived out of order.
     */
    if (!this.bus.observe(envelope)) {
      this.bus.settle(
        envelope,
        "applied",
        "processed out of order; ordering is applied downstream",
      );
    } else {
      this.bus.settle(envelope, "applied");
    }

    const work = this.invalidateFile(filePath, force, content).catch((err) => {
      this.logger.error(`Invalidation failed for ${subject}: ${String(err)}`);
      return [] as string[];
    });
    this.updateCustody.set(subject, { seq, work });

    return work;
  }

  public async invalidateFile(
    filePath: string,
    force = false,
    /**
     * The file's contents as the caller already read them.
     *
     * Re-reading from disk here is what let a later write become a no-op: the
     * watcher is unqueued, so two changes in quick succession produce two
     * concurrent invalidations, and both read whatever is on disk *now*. The
     * earlier invocation would observe the later content, and the later one
     * would then find nothing changed and emit nothing at all.
     */
    content?: string,
  ): Promise<string[]> {
    if (!force && this.io.writingFiles.has(filePath)) {
      /**
       * A write this compiler made is echoing back through the watcher.
       *
       * Named rather than dropped (Axiom D2), because the guard is a time window
       * and a genuine edit landing inside it is silently discarded. That window
       * is a known weakness — Corollary D1a says a timing window is never a
       * guard — but narrowing it needs a content-identity check that survives
       * the formatter rewriting the file after the write, which is Phase 4 work.
       * Until then the loss is at least visible.
       */
      this.bus.settle(
        this.bus.mint("io/write", this.io.getNormalizedId(filePath)),
        "failed",
        "suppressed by the self-write guard",
      );
      return [];
    }

    const normalizedPath = this.io.getNormalizedId(filePath);
    const absoluteOutputDir = isAbsolute(this.catalog.outputDir)
      ? this.catalog.outputDir
      : join(this.root, this.catalog.outputDir);
    const normalizedOutputDir = this.io.getNormalizedId(absoluteOutputDir);
    const isInsideOutputDir = normalizedPath.startsWith(normalizedOutputDir + "/");

    // If it's a supported asset (md, txt, json, etc) and NOT inside the output dir
    // OR if it's a localized asset inside the output dir
    const context = this.getCompilerContext();
    let matchedFacet = this._resolved.system.contentFacets.find((a) => a.match(filePath, context));
    if (isInsideOutputDir) {
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.isLocalizedOutput && (await facet.isLocalizedOutput(filePath, context))) {
          matchedFacet = facet;
          break;
        }
      }
    }

    if (matchedFacet) {
      if (!isInsideOutputDir && matchedFacet.discover) {
        await matchedFacet.discover(filePath, context);
      }
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
          // Prefer the content the caller was handed. Falling back to disk is
          // only for callers that have none — see the `content` parameter.
          const code = content ?? (await this.io.readFile(filePath));
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

    // 3. Check if it's a localized output of a content facet
    for (const facet of this._resolved.system.contentFacets) {
      if (facet.getBoundaryForLocalizedOutput) {
        const bId = await facet.getBoundaryForLocalizedOutput(filePath, context);
        if (bId && !foundBoundaryIds.includes(bId)) {
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
    if (foundBoundaryIds.length > 0) {
      // A real change: every catalog generated from here on describes a newer
      // world than anything already delivered.
      this.catalogGeneration++;
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

    if (this._resolved.system.virtualBoundaries.includes(boundaryId)) {
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
        } else {
          const context = this.getCompilerContext();
          const matched = this._resolved.system.contentFacets.find((a) =>
            a.match(fullPath, context),
          );
          if (matched && matched.discover) {
            tasks.push(Promise.resolve(matched.discover(fullPath, context)));
          }
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

    /**
     * The generation this rebuild belongs to.
     *
     * `graphDirty` is cleared *before* the async body runs, so a `transform`
     * during the rebuild sets it again and the next call starts a second,
     * concurrent rebuild. Both then assigned `boundaryGraph`/`chunkGraph` on
     * completion, and the winner was whichever *finished* last rather than
     * whichever started last — the same race as a stale hot update, in the
     * compiler.
     *
     * A graph rebuild genuinely replaces state (unlike invalidation, ZDB §4.1a),
     * so D1 is the right rule here: a rebuild whose generation has been overtaken
     * discards its result instead of overwriting a newer world.
     */
    const generation = ++this.graphGeneration;
    const envelope = this.bus.mint("build/pipeline", "graph", { seq: generation });
    this.bus.accept(envelope);

    this.rebuildPromise = (async () => {
      const context = this.getCompilerContext();
      // In dev mode, we add a special shared boundary for assets
      if (this.isDev) {
        const assetTranslations: Record<string, string> = {};
        for (const facet of this._resolved.system.contentFacets) {
          if (facet.getTranslations) {
            const tr = await facet.getTranslations(this.sourceLocale, context);
            Object.assign(assetTranslations, tr);
          }
        }
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
          const locAssets: Record<string, string> = {};
          for (const facet of this._resolved.system.contentFacets) {
            if (facet.getTranslations) {
              const tr = await facet.getTranslations(loc, context);
              Object.assign(locAssets, tr);
            }
          }
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
        this._resolved.system.virtualBoundaries,
        this._resolved.system.contentFacets,
        context,
      );
      this.graph.propagateActiveLocales(g);
      const c = this.graph.computeTranslationChunks(
        g,
        this.messages.internalManifest,
        this.messages.metadataGraph,
        this._resolved.system.virtualBoundaries,
      );
      if (!this.bus.holds(envelope)) {
        // A newer rebuild started while this one was running; its result is the
        // current world. Discard ours rather than overwrite it.
        this.bus.settle(envelope, "superseded", "a newer graph rebuild took the slot");
        return;
      }
      this.graph.boundaryGraph = g;
      this.graph.chunkGraph = c;
      this.bus.settle(envelope, "applied");
      return;
    })();
    return this.rebuildPromise;
  }

  public async transformHtml(
    html: string,
    id: string,
    preloads?: Record<string, string[]>,
  ): Promise<string> {
    const context = this.getCompilerContext();
    for (const facet of this._resolved.system.contentFacets) {
      if (facet.transformHtml) {
        return await facet.transformHtml(html, id, context, preloads);
      }
    }
    return html;
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
    if (
      (id.includes("node_modules") && !isTargetSsrEntry) ||
      (id.startsWith("\0") && !isTargetSsrEntry)
    )
      return;
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
          sinks: [],
        };
        this.messages.trackBoundaryChange(fileId, new Set([fileId]));
        this.messages.internalManifest[fileId] = [];
      } else {
        observation = observe(
          codeToUse,
          effectiveCleanId,
          fileId,
          this.logger.withPrefix("Extractor"),
          { compiledState: this._resolved.extraction },
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
          sinks: observation.sinks,
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
      /**
       * Route the pipeline's own diagnostics somewhere they can be read.
       *
       * `resolve` and `apply` have always produced a structured `Diagnostic[]`
       * — overlapping rewrites dropped, duplicates merged, redundant edits
       * suppressed — and every one of them was written to a field nobody ever
       * looked at. A dropped rewrite is a source mutation that did not happen,
       * which is exactly the class of loss the ledger exists to name.
       *
       * Only `warn` and `error` are recorded: `info` covers ordinary merges
       * that happen on almost every transform, and a ledger that reports
       * routine work is one nobody reads.
       */
      for (const diagnostic of [...plan.diagnostics, ...result.diagnostics]) {
        if (diagnostic.severity === "info") continue;
        this.bus.settle(
          this.bus.mint("build/pipeline", `transform:${effectiveCleanId}`),
          "failed",
          `${diagnostic.severity}: ${diagnostic.message}`,
        );
      }

      const validation = validate(
        result,
        plan,
        activeObservation,
        this.logger.withPrefix("Pipeline"),
      );
      if (!validation.valid) {
        this.logger.error(`Validation failed for ${id}:`, validation.errors);
        for (const error of validation.errors) {
          this.bus.settle(
            this.bus.mint("build/pipeline", `transform:${effectiveCleanId}`),
            "failed",
            // Serialized, not stringified: every variant is a discriminated
            // object, so `String(error)` yields "[object Object]" and loses
            // the one field that says what went wrong.
            `validation: ${JSON.stringify(error)}`,
          );
        }
      }
    }

    if (this.isDev) this.scheduleFlush();

    let finalCode = result.code;
    let ssrWrapped = false;
    if (ssr && this._resolved.system.ssrWrapCode) {
      const wrapped = this._resolved.system.ssrWrapCode({
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
          finalCode = finalCode.replace(funcRegex, "async function _zintl_raw_render");
          finalCode += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
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
                  finalCode += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
                  break;
                }
              }
            }
          }
        }

        // 2. Generic Default Export Wrapping
        if (this._resolved.system.ssrWrapDefault) {
          const defaultExportRegex = /(^|\n)export\s+default\b/;
          const exportBlockRegex = /export\s*\{([^}]+)\}/g;
          let hasDefault = defaultExportRegex.test(finalCode);
          let wrappedDefault = false;

          if (hasDefault) {
            finalCode = finalCode.replace(defaultExportRegex, "$1const _zintl_raw_default = ");
            wrappedDefault = true;
          } else {
            // Check for export { ... as default ... }
            let match;
            exportBlockRegex.lastIndex = 0;
            while ((match = exportBlockRegex.exec(finalCode)) !== null) {
              const content = match[1];
              if (/\bdefault\b/.test(content)) {
                const parts = content.split(",").map((p) => p.trim());
                const index = parts.findIndex((p) => p === "default" || p.endsWith(" as default"));
                if (index !== -1) {
                  const part = parts[index];
                  if (part === "default") {
                    const fullExportStr = match[0];
                    parts[index] = "default as _zintl_raw_default";
                    const newBlock = `export { ${parts.join(", ")} }`;
                    finalCode = finalCode.replace(fullExportStr, newBlock);
                    wrappedDefault = true;
                    break;
                  } else if (part.endsWith(" as default")) {
                    const localName = part.substring(0, part.length - " as default".length).trim();
                    parts[index] = `${localName} as _zintl_raw_default`;
                    const newBlock = `export { ${parts.join(", ")} }`;
                    finalCode = finalCode.replace(match[0], newBlock);
                    wrappedDefault = true;
                    break;
                  }
                }
              }
            }
          }

          if (wrappedDefault) {
            if (!finalCode.includes("import { runInRequestScope as _zintl_runInRequestScope }")) {
              finalCode += `\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";`;
            }
            finalCode += `\nexport default function _zintl_wrapped_default(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => {\n    if (typeof _zintl_raw_default === "function") return _zintl_raw_default(urlOrReq, ...args);\n    if (_zintl_raw_default && typeof _zintl_raw_default.fetch === "function") return _zintl_raw_default.fetch(urlOrReq, ...args);\n    return _zintl_raw_default;\n  });\n}`;
          }
        }

        // 3. Generic Named Exports Wrapping
        if (
          this._resolved.system.ssrWrapExports &&
          this._resolved.system.ssrWrapExports.length > 0
        ) {
          for (const name of this._resolved.system.ssrWrapExports) {
            let wrappedExport = false;
            let wrapType: "rename" | "alias" = "rename";

            // Syntax 1: export (async )?function name
            const namedFuncRegex = new RegExp(
              `(^|\\n)export\\s+(async\\s+)?function\\s+${name}\\b`,
            );
            if (namedFuncRegex.test(finalCode)) {
              finalCode = finalCode.replace(namedFuncRegex, `$1async function _zintl_raw_${name}`);
              wrappedExport = true;
              wrapType = "rename";
            }

            // Syntax 2: export const/let/var name = ...
            if (!wrappedExport) {
              const constRegex = new RegExp(`(^|\\n)export\\s+(const|let|var)\\s+${name}\\b`);
              if (constRegex.test(finalCode)) {
                finalCode = finalCode.replace(constRegex, `$1$2 _zintl_raw_${name}`);
                wrappedExport = true;
                wrapType = "rename";
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
                      parts[index] = `_zintl_wrapped_${name} as ${name}`;
                      wrappedExport = true;
                      wrapType = "alias";
                    } else if (part.endsWith(` as ${name}`)) {
                      parts[index] = `_zintl_wrapped_${name} as ${name}`;
                      wrappedExport = true;
                      wrapType = "alias";
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
              if (!finalCode.includes("import { runInRequestScope as _zintl_runInRequestScope }")) {
                finalCode += `\nimport { runInRequestScope as _zintl_runInRequestScope } from "${runtimeInternal}";`;
              }
              if (wrapType === "rename") {
                finalCode += `\nexport async function ${name}(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_${name}(urlOrReq, ...args));\n}`;
              } else {
                finalCode += `\nasync function _zintl_wrapped_${name}(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => ${name}(urlOrReq, ...args));\n}`;
              }
            }
          }
        }
      }
    }

    if (this.isDev) {
      const hmrFn = this._resolved.system.hmrInjectionCode;
      let hmrToken = 0;
      const fileBoundaries = (this.messages as any).boundaryOwnership.get(fileId);
      if (fileBoundaries) {
        for (const bId of fileBoundaries) {
          hmrToken += this.boundaryRevisions.get(bId) || 0;
        }
      }

      if (hmrFn) {
        const fileMeta = (this.messages as any)?.metadataGraph?.[fileId];
        const hasAnchors = (fileMeta?.anchorSites?.length || 0) > 0;
        const hmrCode = hmrFn(fileId, hmrToken, hasAnchors);
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
      }
    }

    return finalCode !== code ? { code: finalCode, map: result.map } : undefined;
  }

  private scheduleFlush() {
    if (this.autoFlushTimeout) clearTimeout(this.autoFlushTimeout);
    this.autoFlushTimeout = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  public async flush(): Promise<void> {
    if (this.autoFlushTimeout) {
      clearTimeout(this.autoFlushTimeout);
      this.autoFlushTimeout = null;
    }

    if (this.flushPromise) {
      /**
       * Axiom D3 — a caller arriving mid-flush is not served by the in-flight
       * run, so it must not be handed that run's promise.
       *
       * The running flush snapshotted its dirty set before this caller's
       * boundaries were added to it, so awaiting it means "someone else's work
       * finished", not "your change was flushed". Queue a follow-on and resolve
       * when *that* completes.
       *
       * The in-flight run's failure belongs to whoever started it; this caller
       * only cares whether its own follow-on lands.
       */
      /**
       * A mid-flush caller joins the in-flight run, and its boundaries stay
       * dirty for the next one.
       *
       * The stricter reading of Axiom D3 would be a follow-on flush, so the
       * returned promise means "your change landed" rather than "someone else's
       * work finished". That was built, and measured, and removed: the flush
       * body reaches back into the compiler — `syncGraphs` asks content facets
       * for translations, that can transform, and `transform` schedules a flush
       * — so an unconditional follow-on livelocked, and a guarded one still cost
       * a full extra pass per hot update and destabilised HMR contracts under
       * parallel load.
       *
       * What actually made the defect a defect was the *destructive clear*: the
       * in-flight run wiped the whole dirty set on the way out, including
       * boundaries it never adopted, so a mid-flush change was not deferred but
       * discarded. That is fixed in `runFlush`. With the dirt preserved, the
       * next trigger flushes it — the debounce timer is already scheduled by the
       * `transform` that dirtied it.
       *
       * So the guarantee here is "your change will be flushed", not "it has been
       * flushed by the time this resolves". Weaker than D3 asks for, and stated
       * rather than glossed: no caller in the compiler awaits this for
       * read-after-write, and buying the stronger promise cost more than it was
       * worth.
       */
      const queued = this.bus.mint("build/pipeline", "flush");
      this.bus.settle(
        queued,
        "superseded",
        "joined the in-flight flush; dirt retained for the next",
      );
      return this.flushPromise;
    }

    const envelope = this.bus.mint("build/pipeline", "flush");
    this.bus.observe(envelope);

    this.flushPromise = this.runFlush();
    try {
      await this.flushPromise;
      this.bus.settle(envelope, "applied");
    } catch (err) {
      this.bus.settle(envelope, "failed", String(err));
      throw err;
    } finally {
      /**
       * Always cleared, which it was not.
       *
       * This assignment used to be the last statement *inside* the async body,
       * so a single throw left a rejected promise cached — and every subsequent
       * flush for the life of the process returned that same rejection.
       * `verifyIntegrity` throws by design on a missing translation, and the
       * hot-update hook swallows the result with `.catch`, so the compiler could
       * enter a state where it never flushed again and nothing said so.
       */
      this.flushPromise = null;

      /**
       * Cancel a flush the flush itself asked for.
       *
       * `runFlush` reaches back into the compiler — `syncGraphs` asks content
       * facets for translations, and that can transform, and `transform`
       * schedules a flush. So every flush left a timer behind that fired 300 ms
       * later and ran a second, entirely redundant one. Absorbing it used to be
       * free, because a flush arriving mid-flight was silently dropped; now that
       * callers get a real follow-on, the same timer costs a full extra pass on
       * every hot update.
       *
       * Only cancelled when there is genuinely nothing left. Anything dirtied
       * during the run stays in `dirtyBoundaries` and keeps its timer.
       */
      if (
        this.autoFlushTimeout &&
        this.messages.dirtyBoundaries.size === 0 &&
        !this.messages.hiveDirty
      ) {
        clearTimeout(this.autoFlushTimeout);
        this.autoFlushTimeout = null;
      }
    }
  }

  private async runFlush(): Promise<void> {
    {
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

      const activeContentPaths = new Set<string>();
      const context = this.getCompilerContext();
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.getActiveOutputPaths) {
          const paths = await facet.getActiveOutputPaths(context);
          for (const p of paths) {
            activeContentPaths.add(p);
          }
        }
      }

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
        activeContentPaths,
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

      const contentStatesToSave: Record<string, any> = {};
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.getStateToSave && facet.name) {
          contentStatesToSave[facet.name] = facet.getStateToSave(context);
        }
      }
      await this.messages.saveManifest(this.outputDir, contentStatesToSave);

      /**
       * The dirty boundaries this run takes custody of.
       *
       * Held separately from `affectedBoundaries` because only these may be
       * cleared at the end. Anything dirtied *while* this run is in flight was
       * never adopted by it, and clearing the whole set destroyed exactly those
       * — so a change that arrived mid-flush was not merely deferred, it was
       * discarded, and the follow-on flush found nothing to do.
       */
      const adopted = new Set<string>(this.messages.dirtyBoundaries);
      const affectedBoundaries = new Set<string>(adopted);
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
      // Only what this run adopted — see `adopted` above.
      for (const bId of adopted) this.messages.dirtyBoundaries.delete(bId);

      // Run flush on all content facets
      const flushCtx = this.getCompilerContext();
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.flush) {
          await facet.flush(flushCtx);
        }
      }

      await this.verifyIntegrity();
      this.logger.debug("Flush complete");
      this.messages.commitReconciliation();
      /**
       * Write the hive from the state this flush reconciled.
       *
       * The hive had its own debounce timer on the same 300 ms constant as the
       * flush, and nothing sequenced the two — so a burst of edits could write
       * the hive from a state the flush had not yet reconciled. Writing it here
       * makes the flush the authority; the timer survives only as a fallback for
       * when no flush follows, and is a no-op once this has run.
       */
      await this.messages.flushHive();
    }
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
      this._resolved.system.virtualBoundaries,
      this._resolved.system.contentFacets,
      this.getCompilerContext(),
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
      this._resolved.system.virtualBoundaries,
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
        extensions: this.extensions,
        // Resolved facet state — subsystems read these
        capabilities: this._resolved.flags,
        system: this._resolved.system,
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
        this._resolved.system.contentFacets,
        this.getCompilerContext(),
      );
      const importsCode = imports && imports.length > 0 ? imports.join("\n") + "\n" : "";
      const serialized = this.catalog.serializeCatalog(cat, loc, 4, this.logger);
      let code = `${importsCode}const catalog = ${serialized};\n`;
      if (this.isDev) {
        // The generation travels with the catalog so the receiver can discard an
        // out-of-order arrival by number (ZDB Axiom D1) instead of applying
        // whichever fetch happened to land last.
        code += `if (typeof globalThis !== "undefined" && globalThis.__zintl_active) {
  globalThis.__zintl_active.addCatalogs({ [${JSON.stringify(loc)}]: catalog }, ${this.catalogGeneration});
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
      this._resolved.system.contentFacets,
      this.getCompilerContext(),
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
    const messages = this.getMessages(bId);
    const managerObj = `{ id: "${this.io.getSafeBoundaryId(bId)}", loader: ${loader}, manifest: ${JSON.stringify(messages)} }`;
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

export function getRuntimeCode(
  moduleName:
    | "store"
    | "resolver"
    | "registry"
    | "internal"
    | "store-core"
    | "store-client"
    | "store-server",
  capabilities?: CapabilityFlags,
  isSsr?: boolean,
  sourceLocale?: string,
  /**
   * Whether the runtime is being served for development.
   *
   * Defaults to `false` so a caller that forgets gets the production runtime:
   * the failure mode is "no debug output", never "debug machinery shipped to
   * users".
   */
  isDev = false,
): string {
  const cleanName = String(moduleName).replace(".mjs", "").replace(".js", "");

  if (cleanName === "store" && capabilities) {
    let code = `export * from "./store-core.js";\n`;
    if (capabilities.clientLocaleSync) {
      code += `import "./store-client.js";\n`;
    }
    if (capabilities.serverRequestScope && (isSsr === undefined || isSsr)) {
      code += `import "./store-server.js";\n`;
    }
    return code;
  }

  const mjsPath = join(__dirname, "runtime", `${cleanName}.mjs`);
  const jsPath = join(__dirname, "runtime", `${cleanName}.js`);
  const tsPath = join(__dirname, "runtime", `${cleanName}.ts`);
  const path = existsSync(mjsPath) ? mjsPath : existsSync(jsPath) ? jsPath : tsPath;
  if (!existsSync(path)) {
    throw new Error(`[Zintl] Runtime module not found: ${moduleName} (resolved to ${path})`);
  }
  let code = readFileSync(path, "utf-8");
  /**
   * Resolve the dev sentinel to a literal.
   *
   * This is the substitution that makes the guard actually work: as a literal
   * `false`, minifiers eliminate the branch and its body; as a literal `true`,
   * dev logging and the settle beacon are reachable in the browser — which they
   * were not while the check depended on `typeof process`.
   */
  code = code.replace(/\b__ZINTL_DEV__\b/g, isDev ? "true" : "false");
  if (cleanName === "store-core" && sourceLocale) {
    code = code
      .replace(
        /sourceLocale\s*:\s*string\s*=\s*["']en["']/g,
        `sourceLocale: string = "${sourceLocale}"`,
      )
      .replace(/sourceLocale\s*=\s*["']en["']/g, `sourceLocale = "${sourceLocale}"`);
  }
  return code;
}
