import * as Extractor from "@zintljs/extractor";
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute, dirname, normalize, relative } from "node:path";
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
import type { ManifestEntry } from "./reconcile.js";
import { selfAcceptHmrSnippet } from "./utils/hmr.js";
import { toPosixPath, isExamplePath, normalizeOutputPath } from "./utils/paths.js";
import { isTestEnvironment } from "./utils/env.js";
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
  type CatalogFormatContext,
  type CompilerCapabilities,
  type CapabilityFlags,
  type CompilerContext,
  type FileObservation,
  type BoundaryGraph,
  type SourceLocation,
} from "./types/index.js";
import type { SourceMap } from "magic-string";

import { IOManager } from "./managers/IOManager.js";
import { GraphManager } from "./managers/GraphManager.js";
import { CatalogManager } from "./managers/CatalogManager.js";
import { MessageManager } from "./managers/MessageManager.js";
import { DeliveryBus } from "./bus/index.js";

export { generateMessageId, sha1 } from "./utils/hashing.js";
export { serializeDeterministic } from "./utils/serialization.js";
export { compileExtractionState } from "./capabilities/compile-targets.js";
export type { ExtractionContribution } from "./capabilities/compile-targets.js";
import type { HtmlProjectionPayload } from "@zintljs/extractor";
export type {
  CompilerOptions,
  LogLevel,
  AssetTargetConfig,
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

/**
 * A sink type, as something to show a translator.
 *
 * `ObservedSink.sinkType` is written for two audiences at once. From JSX it is
 * already human — `div`, `button`, the element the text sat in. From HTML it is
 * machine — `html:attr:alt` names the attribute *and* how to splice a
 * replacement back into source. A translator can act on `alt`; `html:attr:alt`
 * tells them nothing, so the transport prefix is dropped.
 *
 * Metadata only. This never participates in message identity — see
 * {@link ManifestEntry.context} and proposal 032 §8.1 — which is what makes
 * normalising it for readability a safe thing to do at all.
 */
function translatorContext(sinkType: string | undefined): string | undefined {
  if (!sinkType) return undefined;
  if (sinkType.startsWith("html:attr:")) return sinkType.slice("html:attr:".length) || undefined;
  /**
   * The one sink type that names a position rather than a thing — and the one
   * place this is thinner than it looks. JSX reports the element (`button`),
   * because the visitor has it; every HTML text node arrives as `HTML_TEXT`, so
   * an `<h1>` and a `<p>` are indistinguishable by the time it reaches here.
   * Closing that is extractor work. Proposal 032 §3 assumes the richer version.
   */
  if (sinkType === "HTML_TEXT") return "text";
  return sinkType;
}

/** One `zintl()` anchor naming a locale the project does not build. */
interface UnsupportedAnchorLocale {
  fileId: string;
  locale: string;
}

/** One extracted key with no translation in one locale. */
interface MissingTranslation {
  locale: string;
  key: string;
  fileId: string;
  /** Where the translation belongs; `null` when the boundary has no catalog file. */
  catalogPath: string | null;
}

/**
 * How many missing keys to name per locale before switching to a count.
 *
 * The report exists to make the *shape* of the problem legible in one build —
 * which locales, which files, roughly how much work. Printing all of them
 * instead scrolls the actionable part off the terminal, which is the failure
 * mode this whole report replaced.
 */
const INTEGRITY_SAMPLE_LIMIT = 8;

/** Message keys are user prose and can be long; a sample line stays readable. */
function truncateKey(key: string, max = 60): string {
  const flat = key.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}\u2026`;
}

/**
 * Report every anchor that targets an unconfigured locale, in one error.
 *
 * Raised *instead of* the missing-translation report rather than alongside it:
 * an anchor on a locale nobody builds makes every downstream missing
 * translation a consequence rather than a finding.
 */
function formatUnsupportedAnchorLocales(
  bad: UnsupportedAnchorLocale[],
  configured: string[],
): string {
  const byLocale = new Map<string, string[]>();
  for (const entry of bad) {
    const files = byLocale.get(entry.locale);
    if (!files) byLocale.set(entry.locale, [entry.fileId]);
    else if (!files.includes(entry.fileId)) files.push(entry.fileId);
  }
  const locales = Array.from(byLocale.keys()).sort();

  const lines: string[] = [
    `[Zintl Integrity Error] zintl() targets ${locales.length} ${
      locales.length === 1 ? "locale" : "locales"
    } you do not build.`,
    ``,
    `Configured locales: [${configured.join(", ")}]`,
    ``,
  ];

  for (const locale of locales) {
    const files = byLocale.get(locale)!.slice().sort();
    lines.push(`  "${locale}" \u2014 anchored in:`);
    for (const file of files.slice(0, INTEGRITY_SAMPLE_LIMIT)) lines.push(`      ${file}`);
    if (files.length > INTEGRITY_SAMPLE_LIMIT) {
      lines.push(`      \u2026 and ${files.length - INTEGRITY_SAMPLE_LIMIT} more`);
    }
    lines.push(``);
  }

  lines.push(`Fix: add the locale to \`locales\`, or correct the zintl() call.`);
  return lines.join("\n");
}

/**
 * Report every missing translation in one error.
 *
 * The rule this enforces is unchanged and deliberately absolute. Only the
 * announcement changed: throwing on the first missing key meant a project
 * adopting Zintl discovered N missing translations across N builds.
 *
 * Two shapes, because the two situations are not the same problem. When every
 * locale is missing the same strings the catalogs simply have not been filled
 * in yet — one listing says that, where per-locale grouping would repeat it
 * once per locale and bury the actionable part. When the sets differ, the
 * question is *which* locale fell behind, and grouping by locale answers it.
 */
function formatMissingTranslations(missing: MissingTranslation[], sourceLocale: string): string {
  const byLocale = new Map<string, MissingTranslation[]>();
  for (const entry of missing) {
    const bucket = byLocale.get(entry.locale);
    if (bucket) bucket.push(entry);
    else byLocale.set(entry.locale, [entry]);
  }
  const locales = Array.from(byLocale.keys()).sort();

  const header = `[Zintl Integrity Error] ${missing.length} missing ${
    missing.length === 1 ? "translation" : "translations"
  } across ${locales.length} ${locales.length === 1 ? "locale" : "locales"}.`;

  const rule = [
    `Zintl never falls back to "${sourceLocale}", so these strings would render empty.`,
    `That is why this is a build error rather than a warning.`,
  ];

  const footer = [
    `Fix:   fill in the empty values in the catalog files above.`,
    `Defer: set \`verifyIntegrity: false\` to skip this check while you evaluate`,
    `       \u2014 those strings will render empty until they are translated.`,
  ];

  const uniform = locales.length > 1 && isUniformAcrossLocales(byLocale, locales);
  const lines = uniform
    ? [
        header,
        ``,
        `Every locale (${locales.join(", ")}) is missing the same ${
          byLocale.get(locales[0])!.length
        } strings.`,
        `The catalogs have most likely not been filled in yet.`,
        ``,
        ...rule,
        ``,
        ...describeUniform(byLocale.get(locales[0])!, byLocale, locales),
      ]
    : [header, ``, ...rule, ``, ...describePerLocale(byLocale, locales)];

  return [...lines, ...footer].join("\n");
}

/**
 * The asset half of the integrity report.
 *
 * Its own formatter rather than a branch inside {@link formatMissingTranslations}
 * because the remedies differ, and the second one is the point: an untargeted
 * asset is a shared one, so *"stop targeting it"* is a correct and complete
 * answer for somebody who discovers their asset was never meant to vary by
 * locale — not a workaround. Proposal 035 §6.
 */
function formatUnfilledAssets(
  unfilled: { locale: string; path: string }[],
  root: string,
  sourceLocale: string,
): string {
  const byLocale = new Map<string, string[]>();
  for (const entry of unfilled) {
    const shown = toPosixPath(relative(root, entry.path)) || entry.path;
    const bucket = byLocale.get(entry.locale);
    if (bucket) bucket.push(shown);
    else byLocale.set(entry.locale, [shown]);
  }
  const locales = Array.from(byLocale.keys()).sort();

  const lines = [
    `[Zintl Integrity Error] ${unfilled.length} unfilled localized ${
      unfilled.length === 1 ? "asset" : "assets"
    } across ${locales.length} ${locales.length === 1 ? "locale" : "locales"}.`,
    ``,
    `Every targeted asset needs its own artifact per locale. These files are empty;`,
    `fill them. Zintl scaffolds them empty rather than copying the source, because`,
    `an English PDF at the German path is not a German PDF — and a byte-identical`,
    `copy is a fallback to "${sourceLocale}" that nothing downstream can detect.`,
    ``,
  ];

  for (const locale of locales) {
    const paths = byLocale.get(locale)!.sort();
    lines.push(`  ${locale} — ${paths.length} empty`);
    for (const path of paths) lines.push(`    ${path}`);
    lines.push(``);
  }

  lines.push(
    `Fix:   fill the files above.`,
    `Or:    stop targeting the asset, if it is the same in every locale.`,
    `Defer: set \`verifyIntegrity: false\` to skip this check while you evaluate`,
    `       — those assets will be served empty until they are authored.`,
  );

  return lines.join("\n");
}

/** Do all locales lack translations for exactly the same keys, in the same files? */
function isUniformAcrossLocales(
  byLocale: Map<string, MissingTranslation[]>,
  locales: string[],
): boolean {
  const signature = (entries: MissingTranslation[]) =>
    entries
      .map((e) => `${e.fileId}\u0000${e.key}`)
      .sort()
      .join("\u0001");
  const first = signature(byLocale.get(locales[0])!);
  return locales.every((locale) => signature(byLocale.get(locale)!) === first);
}

/**
 * The fresh-adoption listing: the strings once, grouped by the source file they
 * came from, plus the concrete set of catalogs one of those files needs.
 *
 * The example is built from real `catalogPath` values rather than by
 * substituting a `[locale]` token into `catalogFormat`. The format is
 * user-supplied and need not mention the locale literally, so a token
 * substitution would print paths that do not exist.
 */
function describeUniform(
  entries: MissingTranslation[],
  byLocale: Map<string, MissingTranslation[]>,
  locales: string[],
): string[] {
  const byFile = new Map<string, string[]>();
  for (const entry of entries) {
    const bucket = byFile.get(entry.fileId);
    if (bucket) bucket.push(entry.key);
    else byFile.set(entry.fileId, [entry.key]);
  }

  const lines: string[] = [];
  const files = Array.from(byFile.keys()).sort();
  let shown = 0;
  let filesShown = 0;

  for (const file of files) {
    if (shown >= INTEGRITY_SAMPLE_LIMIT) break;
    const keys = byFile.get(file)!;
    lines.push(`  ${file} \u2014 ${keys.length} ${keys.length === 1 ? "string" : "strings"}`);
    filesShown++;
    for (const key of keys) {
      if (shown >= INTEGRITY_SAMPLE_LIMIT) break;
      lines.push(`    "${truncateKey(key)}"`);
      shown++;
    }
  }
  if (files.length > filesShown) {
    lines.push(
      `  \u2026 and ${files.length - filesShown} more ${
        files.length - filesShown === 1 ? "file" : "files"
      }`,
    );
  }
  lines.push(``);

  // One file's worth of real catalog paths, so the shape is concrete.
  const example = files[0];
  const paths: string[] = [];
  for (const locale of locales) {
    const match = byLocale.get(locale)!.find((e) => e.fileId === example);
    if (match?.catalogPath) paths.push(match.catalogPath);
  }
  if (paths.length > 0) {
    lines.push(`Each file needs one catalog per locale. For ${example}:`);
    for (const path of paths.slice(0, INTEGRITY_SAMPLE_LIMIT)) lines.push(`  ${path}`);
    if (paths.length > INTEGRITY_SAMPLE_LIMIT) {
      lines.push(`  \u2026 and ${paths.length - INTEGRITY_SAMPLE_LIMIT} more`);
    }
    lines.push(``);
  }

  return lines;
}

/** The drifted-locale listing: which locale fell behind, and in which catalogs. */
function describePerLocale(
  byLocale: Map<string, MissingTranslation[]>,
  locales: string[],
): string[] {
  const lines: string[] = [];

  for (const locale of locales) {
    const entries = byLocale.get(locale)!;
    const byCatalog = new Map<string, MissingTranslation[]>();
    for (const entry of entries) {
      const path = entry.catalogPath ?? `(no catalog file \u2014 boundary in ${entry.fileId})`;
      const bucket = byCatalog.get(path);
      if (bucket) bucket.push(entry);
      else byCatalog.set(path, [entry]);
    }

    lines.push(
      `  ${locale} \u2014 ${entries.length} missing in ${byCatalog.size} ${
        byCatalog.size === 1 ? "file" : "files"
      }`,
    );

    let shown = 0;
    for (const path of Array.from(byCatalog.keys()).sort()) {
      if (shown >= INTEGRITY_SAMPLE_LIMIT) break;
      lines.push(`    ${path}`);
      for (const entry of byCatalog.get(path)!) {
        if (shown >= INTEGRITY_SAMPLE_LIMIT) break;
        lines.push(`      "${truncateKey(entry.key)}"`);
        shown++;
      }
    }
    if (entries.length > shown) lines.push(`    \u2026 and ${entries.length - shown} more`);
    lines.push(``);
  }

  return lines;
}

export class ZintlCompiler {
  public readonly io: IOManager;
  public readonly graph: GraphManager;
  public readonly catalog: CatalogManager;
  public readonly messages: MessageManager;
  public readonly ssrBoundaries = new Set<string>();
  public readonly clientBoundaries = new Set<string>();

  /** Pre-resolved facet capabilities + hooks. Set in constructor. */
  public readonly _resolved: CompilerCapabilities;

  public get assets(): unknown {
    const facet = this._resolved?.system.contentFacets.find(
      (a) => a.name === "system-static-assets",
    );
    return facet?.getManagerInstance?.(this.getCompilerContext());
  }

  public get html(): unknown {
    const facet = this._resolved?.system.contentFacets.find(
      (a) => a.name === "system-html-projection",
    );
    return facet?.getManagerInstance?.(this.getCompilerContext());
  }

  /**
   * Whether any content facet owns `filePath`.
   *
   * The host's way of asking instead of guessing. `resolveId` has always asked —
   * through `isSupportedAsset` — and the *load* path always tested for `.md` and
   * `.txt` instead, so a configured `.rst` target was recognised when its import
   * resolved and then unknown when the module loaded, never reaching the
   * substitution the registration was for. Proposal 034 §1.3.
   *
   * Deliberately the whole facet layer rather than the assets facet by name: a
   * project contributing its own content facet is owed the same answer, and a
   * host that reaches for `compiler.assets` has hardcoded which facet matters.
   */
  public ownsContent(filePath: string): boolean {
    return this.contentOwnershipProbe()(filePath);
  }

  /**
   * Whether a content facet answers an import of `filePath` with a per-locale URL.
   *
   * Deliberately not {@link ownsContent}: ownership says whose file this is, and
   * this says whether an import of it should be intercepted. The HTML projection
   * facet owns `.html` and delivers nothing, so conflating the two hands an HTML
   * template to the JavaScript parser.
   */
  public deliversUrl(filePath: string): boolean {
    if (!this._resolved) return false;
    const context = this.getCompilerContext();
    return this._resolved.system.contentFacets.some(
      (f) => f.deliversUrl?.(filePath, context) ?? false,
    );
  }

  /**
   * {@link ownsContent} with the compiler context bound once.
   *
   * The pipeline asks this per dependency edge, per file, per boundary, and
   * building a context inside the predicate would rebuild it on every one of
   * those. Same answer, paid for once.
   */
  private contentOwnershipProbe(): (filePath: string) => boolean {
    if (!this._resolved) return () => false;
    const context = this.getCompilerContext();
    const facets = this._resolved.system.contentFacets;
    return (filePath: string) => facets.some((f) => f.match(filePath, context));
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
  /** @see CompilerOptions.pseudoLocalize */
  public readonly pseudoLocalize: boolean;
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
    /**
     * Deliberately still a byte test, and the odd one out among the `\0` sites.
     *
     * This is not asking "is this module Zintl's own" — that question now goes
     * through `io.isVirtualId`. It is stripping a known prefix so a user's SSR
     * entry pattern can match, and it already tries the unstripped id too, so a
     * host spelling virtual ids differently loses nothing here.
     */
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

  private hashCache: Record<string, string> = {};
  private observationCache: Record<string, FileObservation> = {};
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

  /**
   * The generation stamped into catalogs generated from now on.
   *
   * Public so a test harness can wait causally: read it after a write, then
   * wait until the page's ledger shows a `runtime/catalog` delivery at least
   * that new. That is a real end-to-end signal — this change reached the
   * browser — where waiting on the first update packet of any kind resolves on
   * whatever happened to arrive first, including another worker's.
   */
  public get generation(): number {
    return this.catalogGeneration;
  }

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

    this.logger = new Extractor.ZintlLogger({
      level: options.logLevel,
      prefix: "Zintl/Compiler",
      debug: options.debug,
    });

    this._outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
    this._prune = options.prune ?? true;
    this._verifyIntegrity = options.verifyIntegrity ?? false;
    this.pseudoLocalize = options.pseudoLocalize ?? true;
    this.io = new IOManager(
      root,
      isDev,
      this.logger.withPrefix("IO"),
      options,
      this.extensions,
      this._resolved.facets,
      this._resolved.system.isVirtualId,
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
    this.messages.internalManifest = v;
  }
  public get dependencyGraph() {
    return this.messages.dependencyGraph;
  }
  public set dependencyGraph(v) {
    this.messages.dependencyGraph = v;
  }
  public get metadataGraph() {
    return this.messages.metadataGraph;
  }
  public set metadataGraph(v) {
    this.messages.metadataGraph = v;
  }
  public get dirtyBoundaries() {
    return this.messages.dirtyBoundaries;
  }
  public set dirtyBoundaries(v) {
    this.messages.dirtyBoundaries = v;
  }
  public get boundaryGraph() {
    return this.graph.boundaryGraph;
  }
  public set boundaryGraph(v) {
    this.graph.boundaryGraph = v;
  }
  public get _chunkGraph() {
    return this.graph.chunkGraph;
  }
  public set _chunkGraph(v) {
    this.graph.chunkGraph = v;
  }
  public get ioManager() {
    return this.io;
  }

  /**
   * Run one facet lifecycle step, under an envelope.
   *
   * These fan-outs were bare sequential `await` loops: a facet that threw took
   * the loop with it, so every facet after it in registration order silently
   * never ran, and the only evidence was whichever error happened to surface.
   * Each step now reaches a terminal outcome naming the facet (Axiom D2), and a
   * failure stops the step rather than the remaining facets — the composition is
   * `union`, so the facets are independent and one failing does not make the
   * others wrong.
   */
  private async runFacetStep(
    step: string,
    facetName: string,
    run: () => Promise<void> | void,
  ): Promise<void> {
    const envelope = this.bus.mint("build/pipeline", `${step}:${facetName}`);
    try {
      await run();
      this.bus.settle(envelope, "applied");
    } catch (err) {
      this.bus.settle(envelope, "failed", String(err));
      this.logger.error(`Content facet "${facetName}" failed during ${step}: ${String(err)}`);
    }
  }

  public async setup() {
    await this.messages.loadMetadata();
    const context = this.getCompilerContext();
    for (const facet of this._resolved.system.contentFacets) {
      if (facet.setup) {
        const savedState =
          this.messages.savedContentStates[facet.name || ""] ||
          (facet.name === "system-static-assets" ? this.messages.registeredAssets : undefined);
        await this.runFacetStep("setup", facet.name, () => facet.setup!(savedState, context));
      }
    }
    await this.catalog.harvestHive(
      this.messages.internalManifest,
      this.locales,
      this.messages.hive,
      () => this.messages.markHiveDirty(),
    );
  }

  public async safeGenerateSchema(path: string, msgs: ManifestEntry[]) {
    return this.catalog.generateSchema(path, msgs);
  }
  public ensureSchemaAtTop(cat: Record<string, string>, sPath: string, cPath: string) {
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
    return this.io.writingFiles.has(path);
  }
  /**
   * Does this path already hold the content the compiler has?
   *
   * The question {@link isWritingFile} was standing in for. That one answers "am
   * I writing this *right now*", which is a 500 ms window, and ZDB Corollary D1a
   * says a window is never a guard. Content identity does not expire, and it
   * covers the case the window never could: a watcher report for a file **nobody
   * changed**, which the compiler otherwise treats as an edit and — for an HTML
   * boundary — answers with a full page reload.
   *
   * `content` is the text the host already read for this event, where it has
   * one; otherwise the file is re-read. See {@link IOManager.knownContent}.
   */
  public async isUnchangedContent(path: string, content?: string): Promise<boolean> {
    if (this.isWritingFile(path)) return true;
    return this.io.isUnchangedContent(path, content);
  }
  /** Accept a path's next event as genuine. See {@link IOManager.forgetWrite}. */
  public forgetKnownContent(path: string) {
    this.io.forgetWrite(path);
  }
  /**
   * Whether a running page could redraw itself from a newly delivered catalog.
   *
   * True when some framework runtime facet declares `repaintsOnCatalogUpdate`.
   *
   * Deliberately **not** `clientReactivityImports`, which was the first thing
   * tried and is a narrower question: it lists the hooks a framework needs
   * *injected*, and only React has any. Vue subscribes through its own
   * reactivity and declares nothing there, so that predicate called Vue
   * unable to repaint and forced it into reloads it did not need — measured, on
   * a project that had been applying catalog edits warm all along.
   *
   * Public because the *host* asks it too, not only `generatedModulesSelfAccept`
   * below. A host's update applier uses it to decide whether a catalog edit needs
   * the boundary's own source module to re-execute: where the page can repaint
   * itself, it does not, and re-executing an anchor file there is what turns a
   * hot update into a reload.
   */
  /**
   * Files whose translations redraw without the module executing again.
   *
   * Written on every transform from the plan's own answer, so it cannot drift
   * from what was actually injected into the file.
   */
  private readonly _repaintingFiles = new Set<string>();

  /**
   * Whether a catalog edit can reach `fileId` without re-executing it.
   *
   * Both halves are required and neither is sufficient. `canRepaint` says the
   * framework has a mechanism at all; this says *this file* was given one. A
   * project can be React and still hold a module with a bare `t()` and no
   * component — nothing there observes the store, and skipping its invalidation
   * drops the translator's edit with no error.
   */
  public fileRepaintsWithoutReexecution(fileId: string): boolean {
    return this._repaintingFiles.has(this.repaintKey(fileId));
  }

  /**
   * One key for a file however the caller spells it.
   *
   * Callers arrive with three spellings of the same file: the absolute path the
   * transform saw, the root-relative `fileId` a boundary carries, and the
   * extension-stripped form `getNormalizedId` produces (`src/main`, ledger
   * L-026). Normalising to root-relative-without-extension is what lets the
   * applier ask about a boundary whose id lost its extension two layers ago.
   *
   * Stripping the extension is safe *here* specifically: the only ids ever added
   * are files that produced a transform plan, so the `src/App.css` /
   * `src/App.tsx` collision that bit ledger L-023 cannot arise — a stylesheet
   * never enters this set.
   */
  private repaintKey(fileId: string): string {
    const rel = isAbsolute(fileId) ? fileId.slice(this.rootDir.length) : fileId;
    return rel
      .replace(/\\/g, "/")
      .replace(/^\//, "")
      .replace(/\.[a-z0-9]+$/i, "");
  }

  public get canRepaint(): boolean {
    return this._resolved.flags.repaintsOnCatalogUpdate === true;
  }

  /**
   * Whether this host's generated catalogs handle their own updates.
   *
   * Derived from the facet's own answer rather than duplicating its reasoning:
   * a host that returns `""` from `hmrSelfAcceptCode` for this project has
   * declared that nothing in the page can act on a new catalog. The plan reads
   * this to force a reload, so the *same* facet decision drives both halves —
   * what the module says about itself, and what the server does about it.
   *
   * Without the second half the update is simply lost on Rspack: a catalog the
   * manager fetches arrives through a dynamic import, which is a chunk boundary
   * with no static parent to bubble to, so declining to accept does not reach a
   * reload the way declining in a statically imported entry does (ledger L-064).
   */
  public get generatedModulesSelfAccept(): boolean {
    return (this._resolved.system.hmrSelfAcceptCode?.(undefined, this.canRepaint) ?? "") !== "";
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
   * {@link getBoundaryInputs}, but only where the host actually consumes it.
   *
   * Gated on `dependencyInvalidation` rather than reported to everyone, because
   * on a host that is already *told* what to invalidate the same declaration is
   * not redundant — it is harmful. Vite treats a declared dependency as a real
   * one, so naming the catalog files here makes Zintl's own `flush()` writes
   * re-enter as source changes and every catalog-writing contract times out.
   * Measured, not reasoned about.
   *
   * Also dev-only: outside a watch build nothing consumes these at all.
   */
  private declaredInputsFor(moduleKey: string, boundaryId: string | string[]): string[] {
    if (!this.isDev || !this._resolved.flags.dependencyInvalidation) return [];

    /**
     * Unioned with what this module has declared before, and never narrowed.
     *
     * The inputs are derived from the boundaries the module *currently*
     * contains, and a boundary can leave: a syntax error makes its file
     * unextractable, so it drops out of the catalog for as long as the error
     * stands. Deriving the watch set from the current contents alone would then
     * stop watching the very file whose repair brings the boundary back — the
     * module is never rebuilt, and `syntax-recovery` sees every one of that
     * boundary's keys go missing rather than just the edited one. Measured that
     * way round before this was added.
     *
     * Monotonic and dev-only, so the set is bounded by the project and watching
     * a file that has become irrelevant costs one spurious rebuild at most.
     */
    const fresh = this.getBoundaryInputs(boundaryId);
    let declared = this.declaredInputMemo.get(moduleKey);
    if (!declared) {
      declared = new Set<string>();
      this.declaredInputMemo.set(moduleKey, declared);
    }
    for (const input of fresh) declared.add(input);
    return Array.from(declared);
  }

  /** Per generated module, every input it has ever declared. See {@link declaredInputsFor}. */
  private readonly declaredInputMemo = new Map<string, Set<string>>();

  /**
   * Every file a boundary's generated catalog is derived from, as absolute paths.
   *
   * The inputs are the boundary's own source files — inverted out of
   * `boundaryOwnership`, which maps the other way — plus the on-disk catalog for
   * each locale. Together they are the complete answer to "what would change this
   * generated module's output".
   *
   * This exists so a host can be *told* the dependency instead of being asked to
   * infer it. Vite's hot-update hook works the other way round: it hands Zintl an
   * event and Zintl walks the module graph deciding what to invalidate. Rspack
   * has no such hook to hand back a module list from — it rebuilds whatever its
   * own dependency graph says is stale, and a virtual module that declares no
   * dependencies is never stale. Reported through `generateVirtualModule`'s
   * existing `watchedFiles`, which every host already forwards to `addWatchFile`;
   * it was returning an empty array for exactly the two module kinds that needed
   * it. Proposal 029.
   *
   * Cheap enough to call per `load`: one pass over `boundaryOwnership` plus one
   * `getCatalogPath` per locale, both in-memory.
   */
  public getBoundaryInputs(boundaryId: string | string[]): string[] {
    const wanted = new Set(Array.isArray(boundaryId) ? boundaryId : [boundaryId]);
    const inputs = new Set<string>();

    /**
     * The **normalized** owner ids behind the requested boundaries.
     *
     * `getCatalogPath` reads an id as `<path>:<func>` — it is a *location*. The
     * ids arriving here are **safe** ids (`b_src_pages_Home_Home`), which are
     * *identities*. Handing one to the other yields
     * `<outputDir>/b_src_pages_Home_Home.<locale>.json`: a file that can never
     * exist, so the watch never fires and the generated module never goes
     * stale. The loop below already knew the incoming id was safe — it compares
     * through `getSafeBoundaryId` — and half the function acted on that while
     * the other half did not. L-026's two-kinds-of-string, a third time.
     */
    const normalizedOwners = new Set<string>();
    const matched = new Set<string>();

    for (const [fileId, owners] of this.messages.boundaryOwnership.entries()) {
      let owned = false;
      for (const owner of owners) {
        const safe = this.io.getSafeBoundaryId(owner);
        if (wanted.has(owner) || wanted.has(safe)) {
          owned = true;
          normalizedOwners.add(owner);
          matched.add(wanted.has(owner) ? owner : safe);
        }
      }
      if (owned) {
        const real = this.resolveSourcePath(fileId);
        if (real) inputs.add(real);
      }
    }

    // A boundary nothing owns — a content boundary contributed by a facet, say —
    // keeps the id it was asked about, which is the behaviour that predates this.
    for (const id of wanted) if (!matched.has(id)) normalizedOwners.add(id);

    for (const id of normalizedOwners) {
      for (const locale of this.locales) {
        const catPath = this.getCatalogPath(id, locale);
        if (catPath) inputs.add(isAbsolute(catPath) ? catPath : join(this.rootDir, catPath));
      }
    }

    /**
     * A facet's virtual boundary is derived from **files**, and only the facet
     * knows which.
     *
     * The loop above answers "what source owns this boundary" out of
     * `boundaryOwnership`, and a virtual boundary like `b_assets` is owned by
     * nothing — it is contributed, not extracted. It therefore declared no
     * inputs at all, which on a host that rebuilds from declared dependencies
     * means a generated catalog embedding an asset **is never stale**. Editing
     * `about.ar.txt` under Rspack rebuilt nothing, delivered nothing, and left
     * the page on the previous text (ZHMR §5, ledger L-067).
     *
     * Asked of the facet rather than special-cased on the id: the core has no
     * business knowing that `b_assets` means `.txt` and `.md` files, and a
     * second facet contributing a virtual boundary would otherwise have to
     * rediscover this the same way.
     */
    for (const facet of this._resolved.system.contentFacets) {
      const virtuals = facet.virtualBoundaries ?? [];
      if (!virtuals.some((v) => wanted.has(v))) continue;
      for (const path of facet.getDeclaredInputs?.(this.getCompilerContext()) ?? []) {
        inputs.add(isAbsolute(path) ? path : join(this.rootDir, path));
      }
    }

    return Array.from(inputs);
  }

  /**
   * Turn a normalized id back into a path that exists on disk.
   *
   * `boundaryOwnership` is keyed by `io.getNormalizedId`, which **strips the
   * source extension** — `src/main.ts` is stored as `src/main`. That is right for
   * identity, which is content-based and must not move when a file is renamed
   * from `.ts` to `.tsx`; it is wrong for anything that hands the string to a
   * filesystem.
   *
   * Handing the extensionless form to a host as a watched dependency was
   * measured doing real damage rather than merely failing: Rspack accepted the
   * dependency, found no such file, and reported `building removed src/main` on
   * every cycle — a watch on a path that can never exist, and a generated module
   * that therefore never went stale.
   *
   * `io.resolvedExtensions` is public for exactly this ("callers that probe
   * extensionless dep ids"). Returns `undefined` rather than guessing when nothing matches, so
   * a caller declares no dependency instead of a false one.
   */
  private resolveSourcePath(fileId: string): string | undefined {
    const abs = isAbsolute(fileId) ? fileId : join(this.rootDir, fileId);
    if (existsSync(abs)) return abs;
    for (const ext of this.io.resolvedExtensions) {
      const candidate = abs + (ext.startsWith(".") ? ext : `.${ext}`);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
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
    if (!force && (await this.io.isUnchangedContent(filePath, content))) {
      /**
       * A write this compiler made is echoing back through the watcher.
       *
       * Asked by content identity — {@link IOManager.isUnchangedContent} — rather than
       * by the clock this used to read. Corollary D1a says a timing window is
       * never a guard, and the window was being used as one; what it needed was
       * a check that survives the formatter rewriting the file after the write.
       *
       * Named rather than dropped (Axiom D2), because a window is still
       * consulted for the instant inside `writeFile` itself, where the bytes on
       * disk match no signature at all — so a genuine edit colliding with a
       * write is still discarded, and the loss stays visible.
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
        /**
         * Assets live in the **hive**, and only `syncGraphs()` refills it.
         *
         * This branch used to announce `b_assets` as affected and schedule a
         * flush, and stop there. Both are about *delivery* — which modules to
         * invalidate, and writing catalogs to disk — and neither re-reads the
         * file that just changed. The asset text a catalog carries comes from
         * `mergeFacetTranslations()`, which runs inside `syncGraphs()` and
         * nowhere else, so without marking the graph dirty the whole cascade
         * ran perfectly against **the previous contents of the file**: the
         * hot update fired, the manager re-imported, the content module
         * re-evaluated, `addCatalogs` applied, and every one of those steps
         * carried the old string.
         *
         * That is why editing a localized asset never reached the page on
         * either host (ZHMR §5, ledger L-067) — the failure was upstream of
         * every host-specific mechanism the section describes, which is
         * precisely why fixing it on one host would not have fixed the other.
         *
         * `generateVirtualModule` already awaits `syncGraphs()` when the graph
         * is dirty, so marking it is the whole of the fix: the next module
         * generation re-reads the asset from disk.
         */
        this.graphDirty = true;

        /**
         * An asset edit is a real change, so it has to advance the clock.
         *
         * This branch returns before the shared bookkeeping below — the cache
         * drop, the boundary revision, and `catalogGeneration++` that every
         * other kind of change goes through. The generation is what the runtime
         * orders deliveries by (ZDB Axiom D1), so a catalog rebuilt around a new
         * asset was stamped with the **same** number as the one already applied
         * and correctly discarded on arrival: `runtime/catalog ar/b_assets #0 →
         * superseded (overtaken by seq 0)`, with the right text in it.
         *
         * That is the third and last layer of L-067, and the most misleading:
         * the compiler was right, the host rebuilt, the bytes were delivered,
         * and the receiver rejected them for being stale — which is exactly what
         * it is supposed to do with a delivery that says it is stale.
         */
        delete this.catalog.getCache()["b_assets"];
        this.boundaryRevisions.set("b_assets", (this.boundaryRevisions.get("b_assets") || 0) + 1);
        this.catalogGeneration++;

        this.scheduleFlush();
        return ["b_assets"];
      }
      return [];
    }

    const foundBoundaryIds: string[] = [];

    // 1. Check if it's a source file (boundary ownership)
    const fileId = this.io.getNormalizedId(filePath);
    const boundaries = this.messages.boundaryOwnership.get(fileId);
    if (boundaries) {
      /**
       * Whether this file's messages are actually known.
       *
       * A parse failure is the ordinary case, not an exotic one: in dev the
       * watcher fires on a file saved mid-keystroke more often than on a
       * finished edit.
       */
      let reextracted = true;

      if (this.isDev && this.extensions.some((ext) => filePath.endsWith(ext))) {
        try {
          // Prefer the content the caller was handed. Falling back to disk is
          // only for callers that have none — see the `content` parameter.
          const code = content ?? (await this.io.readFile(filePath));
          await this.transform(code, filePath, undefined, true);
        } catch (e) {
          reextracted = false;
          this.logger.error(`Failed to re-extract messages during invalidation: ${String(e)}`);
          /**
           * Named, not dropped (Axiom D2). A boundary left alone because its
           * source could not be read is a different outcome from one that was
           * invalidated, and a caller reading the ledger has to be able to tell
           * them apart.
           */
          this.bus.settle(
            this.bus.mint("build/hmr", normalizedPath),
            "failed",
            "re-extraction failed; boundary state left as it was",
          );
        }
      }

      /**
       * Invalidate only what was actually re-read.
       *
       * The `catch` above used to log and fall through, so a file that could not
       * be parsed still marked its boundaries dirty, dropped their catalog
       * cache, bumped their revisions and advanced `catalogGeneration` — every
       * one of those an assertion that new content had been read, made on the
       * strength of content that could not be read at all. The compiler then
       * regenerated catalogs for those boundaries from whatever the failed
       * extraction had left in `internalManifest`, and stamped them with a
       * generation newer than the world they described.
       *
       * Doing nothing is the honest response: the file's messages are unchanged
       * as far as anything here can tell, so the previous state is the best
       * available and the next parseable edit re-extracts it properly. This is
       * the same principle as the no-fallback rule — do not guess at content,
       * and make the gap visible instead.
       */
      if (reextracted) {
        for (const bId of boundaries) {
          foundBoundaryIds.push(bId);
          this.messages.markDirty(bId);
        }
      }
    }

    // 2. Check if it's a catalog file (disk-to-boundary mapping)
    for (const bId of Object.keys(this.messages.internalManifest)) {
      if (this.io.isVirtualId(bId)) continue;
      if (foundBoundaryIds.includes(bId)) continue;
      for (const locale of this.locales) {
        const catPath = this.catalog.getCatalogPath(bId, locale);
        if (catPath && this.io.getNormalizedId(catPath) === this.io.getNormalizedId(filePath)) {
          foundBoundaryIds.push(bId);
          this.messages.markDirty(bId);
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
          this.messages.markDirty(bId);
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

  /**
   * Forget a file that no longer exists, and everything it owned.
   *
   * Nothing called this before, because nothing told the compiler a file had
   * been deleted: the bundler routes unlinks through a path that never reaches
   * `handleHotUpdate`/`hotUpdate`, and the plugin registered no watcher of its
   * own. A deleted boundary therefore stayed in the graph for the life of the
   * process — and dev servers are pooled, so it outlived the thing that created
   * it and leaked into everything downstream.
   *
   * `trackBoundaryChange` already knew how to drop the boundaries a file no
   * longer owns; the gap was that a deletion never reached it. Passing an empty
   * set is exactly "this file owns nothing now".
   *
   * The removed boundaries are marked dirty on purpose. Pruning reclaims their
   * catalogs by comparing the output directory against the live graph, but the
   * flush also has to be told something changed, or a deletion made during an
   * idle moment sits unflushed until an unrelated edit happens to wake it.
   */
  public async removeFile(filePath: string): Promise<string[]> {
    const fileId = this.io.getNormalizedId(filePath);
    const owned = this.messages.boundaryOwnership.get(fileId);

    /**
     * The file's boundaries are what the ownership map lists **and** what the
     * graph holds under this file's id.
     *
     * Those two disagree, and ledger L-071 is what the disagreement looks like
     * from a distance. A file that is an entry, or that carries an HTML
     * projection, registers a boundary whose id is the bare `fileId` — the graph
     * then holds `src/App.tsx` beside `src/App.tsx:default`, and only the second
     * is ever attributed to the file in `boundaryOwnership`. Deleting the file
     * reclaimed one of the two and left the other in the graph for the life of
     * the process:
     *
     * ```
     * Forgetting deleted file: src/App.tsx — owns 1 boundary: src/App.tsx:default
     * …8s later: the compiler still knows a boundary for src/App.tsx
     * Matched by: src/App.tsx
     * ```
     *
     * Matching on the id rather than on the map closes it, and uses the shape
     * the compiler mints ids in: a boundary belongs to a file when it *is* the
     * file id, or is that id with a `:<function>` suffix. Content-addressed ids
     * are unaffected — they are not derived from a path, so they never match,
     * and the ownership map remains the only route to them.
     */
    const byId = new Set<string>();
    for (const nodeId of this.graph.boundaryGraph?.nodes.keys() ?? []) {
      if (nodeId === fileId || nodeId.startsWith(`${fileId}:`)) byId.add(nodeId);
    }
    for (const bId of owned ?? []) byId.add(bId);
    const removed = [...byId];

    if (removed.length === 0 && !this.messages.metadataGraph[fileId]) {
      // Not a file the compiler ever knew about — an asset, a stylesheet, or a
      // file outside the boundary graph. Nothing to forget.
      return [];
    }

    this.logger.debug(
      `Forgetting deleted file: ${fileId} — owns ${removed.length} boundar` +
        `${removed.length === 1 ? "y" : "ies"}: ${removed.join(", ") || "(none)"}`,
    );

    this.messages.trackBoundaryChange(fileId, new Set());
    this.messages.boundaryOwnership.delete(fileId);
    delete this.messages.metadataGraph[fileId];
    delete this.messages.dependencyGraph[fileId];

    for (const bId of removed) {
      delete this.catalog.getCache()[bId];
      delete this.messages.internalManifest[bId];
      /**
       * A removed boundary is scrubbed from the dirty set, never added to it.
       *
       * "Dirty" means *write this boundary's catalog*, so marking a boundary
       * that has just been deleted queues its catalogs to be re-created. That is
       * exactly what happened, and the interleaved debug log names it without
       * ambiguity (ledger L-071):
       *
       * ```
       * Pruning orphaned file: zintl/src/App.svelte.ar.json   +0ms
       * Writing file:          zintl/src/App.svelte.ar.json   +0ms
       * ```
       *
       * The prune was correct all along and was being undone by the write pass
       * that followed it in the same flush.
       *
       * The flag was added to make sure a deletion during an idle moment did not
       * sit unflushed — a real concern, and one already served twice over: this
       * method ends with an explicit `scheduleFlush()`, and a flush deferred by
       * another now gets its own trigger (L-070). Waking the flush and asking it
       * to write are different jobs, and only the first was ever wanted here.
       */
      this.messages.dirtyBoundaries.delete(bId);
      this.messages.dirtyRevisions.delete(bId);
      this.boundaryRevisions.delete(bId);
      this.confirmedOnDisk.delete(bId);
      this.graph.boundaryGraph?.nodes.delete(bId);
      this.graph.boundaryGraph?.entries.delete(bId);
    }

    delete this.hashCache[fileId];
    delete this.observationCache[fileId];
    delete this.hashCache[filePath];
    delete this.observationCache[filePath];

    this.graphDirty = true;
    this.reachableCache = null;
    if (removed.length > 0) this.catalogGeneration++;

    this.bus.settle(
      this.bus.mint("build/hmr", fileId),
      "applied",
      `deleted; forgot ${removed.length} boundar${removed.length === 1 ? "y" : "ies"}`,
    );

    if (this.isDev) this.scheduleFlush();
    return removed;
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

  /**
   * Is this module free of anything a translation could change?
   *
   * A bundler integration propagating a locale across import edges needs this to
   * decide whether a dependency needs a per-locale copy at all. It was
   * previously answered inside the Vite plugin's `resolveId`, which walked
   * `metadataGraph`, `internalManifest` and `dependencyGraph` by hand — the
   * compiler's own structures, reached into from outside, one import edge at a
   * time.
   *
   * The answer was always the graph's to give. Asking here instead means the
   * plan can be computed without a Rollup plugin context, which is the whole
   * portability question: a bundler facet should *apply* id rewrites, not
   * rediscover which ones are needed.
   */
  public isTranslationNeutral(fileId: string): boolean {
    if (!this.messages?.metadataGraph) return false;

    const assets = this.assets as
      | { isSupportedAsset(id: string): boolean; getRegisteredAssets(): string[] }
      | undefined;

    const isAssetLike = (cleanFileId: string): boolean => {
      if (assets?.isSupportedAsset?.(cleanFileId)) return true;
      const registered = assets?.getRegisteredAssets?.() ?? [];
      return registered.some(
        (asset) => asset === cleanFileId || asset.startsWith(cleanFileId + "."),
      );
    };

    return !this.graph.hasTranslatableContent(
      this.getNormalizedId(fileId),
      this.messages.dependencyGraph,
      this.messages.metadataGraph,
      this.messages.internalManifest,
      isAssetLike,
    );
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
    const normalizedOutputDir = toPosixPath(absoluteOutputDir);

    const doDisc = async (d: string) => {
      const entries = await this.io.readEntries(d);
      const tasks: Promise<void>[] = [];
      for (const entry of entries) {
        const fullPath = join(d, entry.name);
        const normalizedFullPath = toPosixPath(fullPath);
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
        const assetTranslations = await this.mergeFacetTranslations(this.sourceLocale, context);
        const assetKeys: ManifestEntry[] = Object.keys(assetTranslations).map((text) => ({
          text,
          id: "asset",
          boundaryId: "b_assets",
          location: { start: 0, end: 0, line: 0, column: 0 },
        }));
        this.messages.internalManifest["b_assets"] = assetKeys;

        if (!this.messages.metadataGraph["b_assets"]) {
          this.messages.metadataGraph["b_assets"] = {
            hasZintlMacro: false,
            hasZintlMarker: false,
            isEntry: false,
            needsLoader: false,
            anchorSites: [],
            internalDependencies: {},
            exportedBoundaries: {},
          };
        }

        for (const loc of this.locales) {
          const locAssets = await this.mergeFacetTranslations(loc, context);
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

  /**
   * Merge every content facet's translations for one locale — composition
   * `union`, with collisions treated as the conflict they are (ZDB Axiom D4).
   *
   * This was `Object.assign` in a loop, so when two facets produced the same key
   * with different text the last facet in iteration order silently won. That is
   * not a merge, it is a coin toss decided by facet registration order, and the
   * losing facet's content simply never appeared.
   *
   * Identical values are not a conflict — two facets agreeing about a string is
   * fine and common.
   */
  private async mergeFacetTranslations(
    locale: string,
    context: CompilerContext,
  ): Promise<Record<string, string>> {
    const merged: Record<string, string> = {};
    const owner = new Map<string, string>();

    for (const facet of this._resolved.system.contentFacets) {
      if (!facet.getTranslations) continue;
      const contributed = await facet.getTranslations(locale, context);
      for (const [key, value] of Object.entries(contributed ?? {})) {
        const previous = owner.get(key);
        if (previous !== undefined && merged[key] !== value) {
          throw new Error(
            `[Zintl] Content facet conflict: "${previous}" and "${facet.name}" both provide ` +
              `the key ${JSON.stringify(key)} for locale "${locale}" with different values. ` +
              `Only one facet may own a content key — rename it in one of them.`,
          );
        }
        merged[key] = value;
        owner.set(key, facet.name);
      }
    }
    return merged;
  }

  public async transformHtml(
    html: string,
    id: string,
    preloads?: Record<string, string[]>,
  ): Promise<string> {
    const context = this.getCompilerContext();
    /**
     * Composition `chain`: every facet transforms in turn, each seeing the
     * previous one's output (ZDB Axiom D4).
     *
     * This used to `return` inside the loop, so the first facet implementing
     * `transformHtml` won and any later one was unreachable code — a facet could
     * be registered, be asked for nothing, and never say so. A chain is also the
     * semantics HTML transformation actually wants: projections, preloads and
     * bootstrap injection compose rather than compete.
     */
    let result = html;
    for (const facet of this._resolved.system.contentFacets) {
      if (facet.transformHtml) {
        result = await facet.transformHtml(result, id, context, preloads);
      }
    }
    return result;
  }

  /**
   * The locales this project renders right-to-left, unioned across facets.
   *
   * Handed to the runtime so the store can set `<html dir>` on every host, not
   * only where an HTML projection is installed. Core stays ignorant of what
   * direction means: it unions the string arrays its content facets return.
   *
   * A `union` rather than a chain — unlike {@link transformHtml}, where each
   * facet rewrites the previous one's output, here every facet contributes an
   * independent fact and none of them can retract another's.
   */
  public async getRtlLocales(): Promise<string[]> {
    const context = this.getCompilerContext();
    const merged = new Set<string>();
    for (const facet of this._resolved.system.contentFacets) {
      if (!facet.rtlLocales) continue;
      for (const locale of await facet.rtlLocales(context)) merged.add(locale);
    }
    return [...merged].sort();
  }

  /**
   * Fold host-declared entry scripts into a freshly observed HTML document.
   *
   * Zintl learns which scripts a document loads by reading `<script src>` out of
   * the markup, and turns them into the document's dependencies — which is how a
   * page reaches a trust anchor and becomes a boundary at all.
   *
   * That is a **Vite/plain-HTML convention, not a universal one.** An Rsbuild
   * template deliberately carries no script tag: the entry is injected at build
   * time from `source.entry`, so the association lives in the build config. With
   * nothing to read, the document reached no boundary, no HTML catalog was ever
   * scaffolded for it, and every question asked about it answered emptily rather
   * than loudly (ledger L-021).
   *
   * So a host that keeps the association elsewhere declares it, and this folds it
   * in at the one point where an observation is produced — updating **both**
   * `htmlProjection.scripts`, which the projection walks to find the winning
   * anchor, and `dependencies`, which reachability is computed from. Updating
   * only the first is the subtle version of this bug: the extractor derives the
   * second from the first *during* extraction, so after the fact they are two
   * separate facts and both have to be told.
   *
   * A union, never a replacement — a host declaring an entry does not mean the
   * markup is wrong about the others.
   */
  private adoptHostHtmlEntries(fileId: string, observation: FileObservation): void {
    const declared = this._options.htmlEntries?.[fileId];
    if (!declared?.length || !observation.htmlProjection) return;

    const scripts = observation.htmlProjection.scripts;
    const deps = observation.dependencies;
    for (const script of declared) {
      if (!scripts.includes(script)) scripts.push(script);
      if (!deps.some((d: { id: string }) => d.id === script)) {
        // No named bindings: a document loads a script, it does not import from it.
        deps.push({ id: script, dynamic: false, bindings: [] });
      }
    }
  }

  async transform(
    code: string,
    id: string,
    _virtualInjectionTarget?: string,
    onlyExtract = false,
    multiplexLocale?: string,
    ssr?: boolean,
  ): Promise<{ code: string; map: SourceMap } | undefined> {
    const isTargetSsrEntry = this.isSsrEntryTarget(id);
    if (
      (id.includes("node_modules") && !isTargetSsrEntry) ||
      (this.io.isVirtualId(id) && !isTargetSsrEntry)
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
          imports: [],
          dependencies: [],
          boundaries: [],
          directives: [],
          contentHash: fileHash,
          existingRuntimeImports: [],
          internalDependencies: {},
          exportedBoundaries: {},
        };
        this.observationCache[effectiveCleanId] = observation;
        this.messages.dependencyGraph[fileId] = [];
        this.messages.metadataGraph[fileId] = {
          hasZintlMarker: false,
          hasZintlMacro: false,
          isEntry: true,
          anchorSites: [],
          needsLoader: false,
          exportedBoundaries: {},
          internalDependencies: {},
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
        this.adoptHostHtmlEntries(fileId, observation);
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

        const messagesByBoundary: Record<string, ManifestEntry[]> = {};
        const processMsg = (msg: {
          text: string;
          boundaryId: string;
          location: SourceLocation;
          sinkType?: string;
          note?: string;
          variables?: { name: string }[];
          passVars?: Record<string, string>;
        }) => {
          if (!messagesByBoundary[msg.boundaryId]) messagesByBoundary[msg.boundaryId] = [];
          messagesByBoundary[msg.boundaryId].push({
            id: generateMessageId(msg.text),
            text: msg.text,
            boundaryId: msg.boundaryId,
            location: msg.location,
            /**
             * Per sink, deliberately not unioned across them.
             *
             * The extractor aggregates its own `contexts` because it keys by
             * message; this keys by sink, so one string reached from a `button`
             * and a `title` produces two entries carrying one context each.
             * That is information rather than duplication, and unioning it here
             * would mean collapsing entries — a change to how many manifest
             * entries exist, which `generateSchema` and `verifyIntegrity` both
             * walk. A consumer that wants the union should take it; see
             * proposal 032 §7.
             */
            context: translatorContext(msg.sinkType),
            note: msg.note,
            variables: [
              ...new Set([
                ...(msg.variables?.map((v) => v.name) || []),
                ...Object.keys(msg.passVars || {}),
              ]),
            ],
          });
        };
        observation.sinks.forEach(processMsg);
        observation.manualTranslations.forEach((m) =>
          processMsg({ text: m.key, boundaryId: m.boundaryId, location: m.location }),
        );

        const trackedBoundaries = new Set(Object.keys(messagesByBoundary));
        observation.anchors.forEach((a) => trackedBoundaries.add(a.boundaryId));
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
      observation.sinks.forEach((s) => bIds.add(s.boundaryId || fileId));
      observation.manualTranslations.forEach((m) => bIds.add(m.boundaryId || fileId));
      observation.anchors.forEach((a) => bIds.add(a.boundaryId));
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
        const isTestEnv = isTestEnvironment();
        const isExample = isExamplePath(cleanId);
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
      anchors: observation.anchors.map((a) => ({
        ...a,
        locale: { ...a.locale },
      })),
      sinks: observation.sinks.map((s) => ({ ...s })),
      manualTranslations: observation.manualTranslations.map((m) => ({ ...m })),
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
      activeObservation.sinks.forEach((s) => relevant.add(s.boundaryId));
      activeObservation.manualTranslations.forEach((m) => relevant.add(m.boundaryId));
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
    /**
     * Recorded per file so a host's update applier can ask about *this* module
     * rather than about the project. See `ResolvedPlan.repaintsWithoutReexecution`.
     */
    const repaintKey = this.repaintKey(effectiveCleanId);
    if (plan.repaintsWithoutReexecution) this._repaintingFiles.add(repaintKey);
    else this._repaintingFiles.delete(repaintKey);

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
      const fileBoundaries = this.messages.boundaryOwnership.get(fileId);
      if (fileBoundaries) {
        for (const bId of fileBoundaries) {
          hmrToken += this.boundaryRevisions.get(bId) || 0;
        }
      }

      if (hmrFn) {
        const fileMeta = this.messages.metadataGraph?.[fileId];
        const hasAnchors = (fileMeta?.anchorSites?.length || 0) > 0;
        /**
         * A framework runtime declares the hook it needs through
         * `clientReactivityImports`; a project with none has only its entry, and
         * on some hosts re-running that is not enough (see the hook's docs).
         */
        const hasClientReactivity =
          Object.keys(this._resolved.system.clientReactivityImports ?? {}).length > 0;
        const hmrCode = hmrFn(
          fileId,
          hmrToken,
          hasAnchors,
          this._resolved.flags.entryReexecutionSafe,
          hasClientReactivity,
        );
        if (hmrCode) {
          finalCode = this.spliceHmrCode(fileId, finalCode, hmrCode);
        }
      } else {
        if (this.messages.metadataGraph[fileId].anchorSites.length > 0) {
          const hmrCode = selfAcceptHmrSnippet(fileId);
          finalCode = this.spliceHmrCode(fileId, finalCode, hmrCode);
        }
      }
    }

    return finalCode !== code ? { code: finalCode, map: result.map } : undefined;
  }

  /**
   * @param trailing Armed by {@link armTrailingFlush} to catch up dirt a joined
   * flush deferred, rather than by a real change. Only a non-trailing schedule
   * clears the no-progress guard, so a genuine edit always re-enables catch-up.
   */
  private scheduleFlush(trailing = false) {
    if (!trailing) this.lastTrailingSignature = null;
    if (this.autoFlushTimeout) clearTimeout(this.autoFlushTimeout);
    this.autoFlushTimeout = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** The dirt a trailing flush was last armed for. See {@link armTrailingFlush}. */
  private lastTrailingSignature: string | null = null;
  /** One trailing arm per in-flight run, however many callers join it. */
  private trailingArmScheduled = false;

  /**
   * What the retained dirt currently is, as a comparable value.
   *
   * Used only to answer "did the last trailing flush achieve anything", so the
   * exact encoding does not matter — only that identical dirt compares equal.
   */
  private dirtSignature(): string | null {
    const boundaries = [...this.messages.dirtyBoundaries].sort();
    if (boundaries.length === 0 && !this.messages.hiveDirty) return null;
    return boundaries.join("|") + (this.messages.hiveDirty ? "|hive" : "");
  }

  /**
   * Give deferred dirt a trigger of its own, once the in-flight flush is done.
   *
   * **The bug this closes (ledger L-070).** `flush()` hands a mid-flush caller
   * the in-flight promise and settles `dirt retained for the next`, justified by
   * "the debounce timer is already scheduled by the `transform` that dirtied
   * it". That holds for every trigger except the last one: `scheduleFlush()`
   * *replaces* the timer, and when it fires `flush()` clears it, finds
   * `flushPromise` set, and returns — leaving nothing scheduled. If no further
   * change arrives, the retained dirt is never flushed at all. Measured on
   * `chaos-boundary`: two flushes, one prune, and a catalog write that never
   * happened.
   *
   * **Why this shape and not the two that were tried.** An unconditional
   * follow-on flush livelocked, because the flush body reaches back into the
   * compiler and dirties state again; a guarded follow-on cost a full extra pass
   * per hot update. This arms the *debounce timer* instead of running a flush,
   * so further changes coalesce into it and a quiet period costs one pass, not
   * one per update.
   *
   * **Why it cannot livelock.** Three conditions, each necessary:
   *
   * 1. Nothing is armed unless dirt actually remains once the in-flight run
   *    finished — the ordinary case leaves none.
   * 2. At most one arm per in-flight run, no matter how many callers joined it.
   * 3. A trailing flush that leaves the dirt *unchanged* does not arm another.
   *    That is the termination guarantee: a chain continues only while it is
   *    making progress, and a real edit clears the guard so genuine work is
   *    never refused.
   */
  private armTrailingFlush() {
    if (this.trailingArmScheduled) return;
    const inFlight = this.flushPromise;
    if (!inFlight) return;
    this.trailingArmScheduled = true;

    const settle = () => {
      this.trailingArmScheduled = false;
      const signature = this.dirtSignature();
      if (signature === null) return;
      if (signature === this.lastTrailingSignature) {
        this.logger.debug(
          "Trailing flush not re-armed: the previous one left the same dirt, so another " +
            "would not make progress.",
        );
        return;
      }
      // A real trigger may already have scheduled one; do not stack timers.
      if (this.autoFlushTimeout) return;
      this.logger.debug("Arming a trailing flush for dirt a joined flush deferred.");
      this.lastTrailingSignature = signature;
      this.scheduleFlush(true);
    };

    inFlight.then(settle, settle);
  }

  public async flush(): Promise<void> {
    if (this.autoFlushTimeout) {
      clearTimeout(this.autoFlushTimeout);
      this.autoFlushTimeout = null;
    }
    // A report queued by the previous flush is about to be superseded by this
    // one, and an unowned timer outliving the compiler holds the process open.
    if (this._statusTimeout) {
      clearTimeout(this._statusTimeout);
      this._statusTimeout = null;
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
      /**
       * "The next" has to exist. The comment above assumed a later trigger
       * would arrive; for the last change before a quiet period none does, and
       * the dirt sat unflushed forever (L-070). See {@link armTrailingFlush}.
       */
      this.armTrailingFlush();
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

  /**
   * Refuse a build where a localized artifact and a catalog want the same file.
   *
   * Both namespaces are `<outputDir>/<path>.<locale>.<ext>` by construction, so
   * an artifact whose extension matches the catalog's — `.json`, in every
   * default configuration — can land exactly where a boundary's catalog goes.
   * Measured: targeting `src/data.json` alongside a boundary in `src/data.ts`
   * puts both at `zintl/src/data.ar.json`, and the catalog is written second and
   * wins. The artifact is then a catalog, `verifyIntegrity` sees a non-empty
   * file and passes, and the content ships in the source language with nothing
   * said — a source-locale fallback wearing an artifact's name, which is the one
   * thing this project's first rule forbids.
   *
   * That is worse than either subsystem failing, because it looks like success,
   * so this refuses rather than picks a winner. Proposal 034 §6, option 1.
   *
   * Not inside the pruning scan, though that is where both sets were already
   * computed: pruning is gated on the `prune` option and on a dev short-circuit,
   * and a correctness guard an unrelated option can switch off is not a guard.
   * §1.4 of that proposal thought the collision was confined to the branch that
   * calls `getCatalogPath`; it is not, because the branch that does not still
   * builds the same naming scheme by hand.
   *
   * Generic over content facets rather than special-cased to assets: the assets
   * preset is the only facet that contributes output paths today, and the
   * collision is a property of the shared naming scheme, not of that preset.
   * Which facet claimed a path is carried through so the message can name it.
   */
  private assertNamespacesDoNotCollide(contentPaths: Map<string, string>): void {
    const graph = this.graph.boundaryGraph;
    if (!graph || contentPaths.size === 0) return;

    const catalogs = this.catalog.catalogOutputPaths(graph, this.locales);
    const collisions: { path: string; facet: string; boundaryId: string }[] = [];
    for (const [path, facet] of contentPaths) {
      const boundaryId = catalogs.get(normalizeOutputPath(this.root, path));
      if (boundaryId) collisions.push({ path, facet, boundaryId });
    }
    if (collisions.length === 0) return;

    const many = collisions.length > 1;
    const lines = [
      `[Zintl] ${
        many
          ? `${collisions.length} localized artifacts land on paths`
          : `A localized artifact lands on a path`
      } Zintl already writes a catalog to.`,
      ``,
      `Catalogs and localized artifacts are both named`,
      `<outputDir>/<path>.<locale>.<ext>, so an artifact whose extension matches the`,
      `catalog format — \`.json\`, in every default configuration — lands exactly`,
      `where a boundary's catalog goes. The catalog is written second and wins: the`,
      `artifact would then *be* a catalog, the integrity gate would see a non-empty`,
      `file and pass, and the content would ship in "${this.sourceLocale}" with nothing said.`,
      ``,
    ];
    for (const { path, facet, boundaryId } of collisions) {
      lines.push(`  ${toPosixPath(relative(this.root, path))}`);
      lines.push(`    claimed by "${facet}", and by the catalog for "${boundaryId}"`);
    }
    lines.push(
      ``,
      `Fix:    give the artifacts their own location, away from the catalogs —`,
      `        assetsTarget: [{ targetPattern: "**/*.json",`,
      `                         outputPattern: "assets/[locale]/[dir]/[name].[ext]" }]`,
      `Or:     stop targeting this extension, or rename the source file.`,
    );
    throw new Error(lines.join("\n"));
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
        return toPosixPath(resolvePath(p)).replace(/\/+$/, "");
      };
      if (this.prune && lastOut && normalizePath(lastOut) !== normalizePath(this.outputDir)) {
        const old = resolvePath(lastOut);
        if (await this.io.exists(old)) {
          await this.io.rm(old);
          this.logger.debug(`Cleaned up old output directory: ${lastOut}`);
        }
      }

      /**
       * Every path the content facets will write to, keyed by the facet that
       * claimed it.
       *
       * Pruning wants the union and nothing else, and had it as a `Set`. The
       * namespace guard below wants to be able to say *whose* output collided,
       * and that is knowable only here, while the contributing facet is still in
       * hand — so the attribution is recorded on the way past and the union is
       * derived from it rather than accumulated alongside it.
       */
      const contentPathOwners = new Map<string, string>();
      const context = this.getCompilerContext();
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.getActiveOutputPaths) {
          const paths = await facet.getActiveOutputPaths(context);
          for (const p of paths) {
            if (!contentPathOwners.has(p)) {
              contentPathOwners.set(p, facet.name ?? "a content facet");
            }
          }
        }
      }
      const activeContentPaths = new Set(contentPathOwners.keys());

      this.assertNamespacesDoNotCollide(contentPathOwners);

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

      const contentStatesToSave: Record<string, unknown> = {};
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
       *
       * That guarded against a *different* boundary dirtied mid-flush, but not
       * the *same* one: this run's own catalog write for an adopted id is
       * awaited below, and a `markDirty` for that exact id can land after the
       * write but before the cleanup at the bottom of this method. The id is
       * still in `adopted`, so an unconditional delete would clear a dirty
       * flag a *newer* edit had just set — discarding that edit with nothing
       * left to schedule it for a later flush. `adoptedRevisions` records what
       * `dirtyRevisions` read at adoption time so the cleanup can tell the two
       * cases apart.
       */
      const adopted = new Set<string>(this.messages.dirtyBoundaries);
      const adoptedRevisions = new Map<string, number>();
      for (const bId of adopted) {
        adoptedRevisions.set(bId, this.messages.dirtyRevisions.get(bId) ?? 0);
      }
      /**
       * Why each boundary is being written, recorded as it is added.
       *
       * A flush has five independent reasons to write a catalog and the write
       * itself cannot tell them apart — which is the gap ledger L-071 spent four
       * excluded hypotheses in. First reason wins: the point is to name what put
       * a path into this pass, and the earliest producer is the one that did.
       */
      const affectedBoundaries = new Set<string>(adopted);
      const writeCause = new Map<string, string>();
      const affect = (bId: string, cause: string) => {
        affectedBoundaries.add(bId);
        if (!writeCause.has(bId)) writeCause.set(bId, cause);
      };
      for (const bId of adopted) writeCause.set(bId, "dirty");
      for (const bId of Object.keys(changes.renames)) affect(bId, "rename");
      for (const move of changes.moves) {
        affect(move.fromBoundary, "move-from");
        affect(move.toBoundary, "move-to");
      }
      for (const bId of Object.keys(changes.deletes)) affect(bId, "delete");

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
            /**
             * The producer with L-071's exact signature, and the one none of its
             * four attempts considered: this writes a boundary *because its
             * catalog is absent from disk* — which is the state
             * `pruneOrphanedBoundaries` created earlier in this same flush.
             * Whether it is the residual writer is a question for the log, not
             * for another guess, so it is named rather than guarded.
             */
            affect(bId, "recover-missing");
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
          causeFor(writeCause, allBIds),
        );
      }
      // Only what this run adopted, and only if nothing re-dirtied it since —
      // see `adoptedRevisions` above.
      for (const bId of adopted) {
        if (this.messages.dirtyRevisions.get(bId) === adoptedRevisions.get(bId)) {
          this.messages.dirtyBoundaries.delete(bId);
        }
      }

      // Run flush on all content facets
      const flushCtx = this.getCompilerContext();
      for (const facet of this._resolved.system.contentFacets) {
        if (facet.flush) {
          await this.runFacetStep("flush", facet.name, () => facet.flush!(flushCtx));
        }
      }

      await this.verifyIntegrity();
      this.scheduleTranslationStatus();
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

  /**
   * Put the dev HMR snippet where the file can legally hold it.
   *
   * An SFC's module code lives inside a `<script>` block, so the snippet has to
   * go **before** that block's closing tag or it lands in the template. Every
   * other file is a module from its first character, and the snippet appends.
   *
   * **The rule used to be `lastIndexOf("</script>")`, unconditionally**, and
   * that reads a string literal as readily as a block. A server entry building
   * its own document — `'<head>' + '<script src="/@vite/client"></script>' +
   * '</head>'`, which is what any SSR shell does in dev — had the snippet
   * spliced *into the string*, producing a module Vite could not parse at all:
   * `Failed to parse source for import analysis`. The app 500s on every
   * request, and only in dev, and only once something puts a script tag in a
   * string (ledger L-073).
   *
   * Which files carry script blocks is a **dialect** fact, so it is asked of
   * the codegen facets rather than guessed from the text — the same correction
   * L-069 made when a framework import was placed outside its `<script setup>`
   * tag. A project with no SFC facet can never take the splice branch.
   */
  private spliceHmrCode(fileId: string, finalCode: string, hmrCode: string): string {
    const isSfc = (this._resolved.system.codegenFacets ?? []).some(
      (facet) => (facet.wrapSfcScript || facet.sfc) && facet.match(fileId),
    );
    if (!isSfc) return finalCode + hmrCode;

    const scriptCloseIdx = finalCode.lastIndexOf("</script>");
    if (scriptCloseIdx === -1) return finalCode + hmrCode;
    return (
      finalCode.substring(0, scriptCloseIdx) + hmrCode + "\n" + finalCode.substring(scriptCloseIdx)
    );
  }

  /**
   * A catalog path as the user would type it, relative to the project root.
   *
   * Reports print one line per catalog, and an absolute path in a deep checkout
   * pushes the part that identifies the file off the right of the terminal.
   * Falls back to the absolute path when the catalog lives outside the root,
   * which a custom absolute `outputDir` allows.
   */
  private relativeCatalogPath(boundaryId: string, locale: string): string | null {
    const absolute = this.catalog.getCatalogPath(boundaryId, locale);
    if (!absolute) return null;
    const rel = relative(this.root, absolute);
    return rel && !rel.startsWith("..") ? toPosixPath(rel) : absolute;
  }

  /**
   * Per-locale translation completeness, as of the last reconciliation.
   *
   * Counted against the **hive** rather than by re-reading catalogs from disk,
   * for two reasons. It is the same thing {@link verifyIntegrity} accepts — a
   * key the hive can satisfy is a key that passes the gate — so the number
   * cannot disagree with whether the build will succeed. And it is pure
   * in-memory set arithmetic, so it costs nothing worth measuring on a dev
   * flush, where re-reading every catalog for every locale would.
   *
   * Source-locale entries are excluded: they are never written to disk and are
   * translated by definition.
   */
  public getTranslationStatus(): { locale: string; translated: number; total: number }[] {
    const keys = new Set<string>();
    for (const entries of Object.values(this.internalManifest)) {
      for (const entry of entries) keys.add(entry.text);
    }

    return this.locales
      .filter((locale) => locale !== this.sourceLocale)
      .map((locale) => {
        const known = this.messages.hive[locale];
        let translated = 0;
        if (known) for (const key of keys) if (known[key]) translated++;
        return { locale, translated, total: keys.size };
      });
  }

  /**
   * The last status line printed, so an unchanged one is not printed again.
   *
   * A dev flush runs on every edit. Without this the terminal fills with the
   * same counts, and the one line that matters — the count changing because a
   * translator just saved a catalog — is the one nobody notices.
   */
  private _lastStatusLine = "";

  private _statusTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Queue a progress report, coalescing a burst of edits into one line.
   *
   * Debounced rather than computed inline, and that is a measurement rather
   * than a preference: counting every manifest key against every locale is
   * cheap in isolation and not cheap on the flush path, which is the HMR hot
   * path. Inline, it pushed `Colony HMR Latency (Manager Sync)` from within
   * budget to 3.2x calibration against a 1.6x budget — caught by `vpr bench`,
   * confirmed by re-running the benchmark with the call removed.
   *
   * Nothing needs this synchronously. It is a number for a human reading a
   * terminal, so it can wait for the edits to stop — which also means one line
   * per burst instead of one per keystroke.
   */
  private scheduleTranslationStatus() {
    if (this._verifyIntegrity) return;
    if (this._statusTimeout) clearTimeout(this._statusTimeout);
    this._statusTimeout = setTimeout(() => {
      this._statusTimeout = null;
      this.reportTranslationStatus();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Announce translation progress while serving.
   *
   * Only while serving, and that is not an oversight: a build either passes
   * {@link verifyIntegrity} at 100% or fails with the list, so a build-time
   * summary could only ever read "everything is translated". Dev is where the
   * number is both true and interesting, and where finding out beats finding
   * out from CI on a Friday.
   */
  private reportTranslationStatus() {
    if (this._verifyIntegrity) return;
    const status = this.getTranslationStatus();
    if (status.length === 0 || status[0].total === 0) return;

    const line = status
      .map(({ locale, translated, total }) => `${locale} ${translated}/${total}`)
      .join(" · ");
    if (line === this._lastStatusLine) return;
    this._lastStatusLine = line;

    /**
     * Severity tracks consequence, not tone.
     *
     * An incomplete locale is not a status update — it is a build that will
     * fail, reported early enough to do something about it. Logged at `info` it
     * is the first thing to disappear for anyone running `logLevel: "warn"`,
     * which is a common choice in CI and in quiet-build setups: they would keep
     * every line they did not care about and lose the one that predicts the
     * failure. `warn` is where a coming failure belongs.
     *
     * Complete is genuinely just news, and stays at `info`.
     */
    const missing = status.reduce((n, s) => n + (s.total - s.translated), 0);
    if (missing === 0) {
      this.logger.info(`Translations complete — ${line}`);
    } else {
      this.logger.warn(
        `Translations ${line} — ${missing} missing, a production build will fail until they are filled`,
      );
    }
  }

  /**
   * Verify every reachable boundary has a translation for every locale.
   *
   * The rule is unchanged and deliberately absolute: there is no fallback to
   * the source locale, so an untranslated string fails the build. What changed
   * is the *reporting*. This used to throw on the first missing key, so a
   * project adopting Zintl discovered its N missing translations across N
   * builds — the worst moment in the onboarding path, and an artifact of how
   * the failure was announced rather than of the rule itself.
   *
   * Both failure classes are collected in full, and anchor-locale errors are
   * raised *instead of* missing translations rather than alongside them. See
   * {@link formatUnsupportedAnchorLocales} and {@link formatMissingTranslations}.
   */
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

    const badAnchors: UnsupportedAnchorLocale[] = [];
    const missing: MissingTranslation[] = [];

    for (const [fileId, meta] of Object.entries(this.messages.metadataGraph)) {
      const fileBoundaries =
        this.messages.boundaryOwnership.get(fileId) || new Set([this.io.getNormalizedId(fileId)]);
      // Only integrity-check boundaries that are genuinely reachable from an anchor.
      const isReachable = Array.from(fileBoundaries).some((b) =>
        reachableFromEntry.has(b as string),
      );

      if (!isReachable) continue;

      for (const anchor of meta.anchorSites) {
        if (anchor.locale.type === "literal") {
          const targetLocale = anchor.locale.value;
          if (targetLocale !== "none" && !this.locales.includes(targetLocale)) {
            badAnchors.push({ fileId, locale: targetLocale });
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
                missing.push({
                  locale,
                  key: msg.text,
                  fileId,
                  catalogPath: this.relativeCatalogPath(bId as string, locale),
                });
              }
            }
          }
        }
      }
    }

    /**
     * Assets are gated too, and by their own question.
     *
     * The string loop above skips `b_assets`, and removing that `continue` would
     * gate nothing: `internalManifest["b_assets"]` is populated only in dev,
     * while this check runs only in a build, so there are no asset keys there to
     * iterate. The artifact on disk is the thing to ask, and asking it also
     * covers a *referenced* asset, whose catalog value is a URL and therefore
     * non-empty however few bytes stand behind it.
     *
     * Same gate, same option, same report — `verifyIntegrity` governs both, and
     * an unfilled asset is a missing translation with a file for a body.
     */
    const unfilledAssets: { locale: string; path: string }[] = [];
    if (!this.isDev) {
      const context = this.getCompilerContext();
      for (const facet of this._resolved.system.contentFacets) {
        if (!facet.getUnfilledOutputs) continue;
        unfilledAssets.push(...(await facet.getUnfilledOutputs(context)));
      }
    }

    if (badAnchors.length > 0) {
      throw new Error(formatUnsupportedAnchorLocales(badAnchors, this.locales));
    }
    if (missing.length > 0 || unfilledAssets.length > 0) {
      const reports: string[] = [];
      if (missing.length > 0) reports.push(formatMissingTranslations(missing, this.sourceLocale));
      if (unfilledAssets.length > 0) {
        reports.push(formatUnfilledAssets(unfilledAssets, this.root, this.sourceLocale));
      }
      throw new Error(reports.join("\n\n"));
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
  public _computeUsageCounts(graph: BoundaryGraph) {
    return this.graph.computeUsageCounts(graph);
  }
  public _computeTranslationChunks(graph: BoundaryGraph) {
    return this.graph.computeTranslationChunks(
      graph,
      this.messages.internalManifest,
      this.messages.metadataGraph,
      this._resolved.system.virtualBoundaries,
    );
  }

  private createWorldState(
    catalogs: Record<string, Record<string, string>> = {},
    isDevOverride?: boolean,
    bakedLocale?: string,
  ): WorldState {
    return {
      manifest: this.messages.internalManifest,
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
        ownsContent: this.contentOwnershipProbe(),
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
          (s) => this.io.getSafeBoundaryId(s.boundaryId) === bId,
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
        /**
         * Whether anything in the page can act on the catalog this module is
         * about to deliver. See `BundlerFacet.hmrSelfAcceptCode`: a host whose
         * applier re-runs the entry ignores this, and one that does not uses it
         * to decline the update so it bubbles to a reload rather than being
         * swallowed (ledger L-064).
         */
        code += this._resolved.system.hmrSelfAcceptCode?.(undefined, this.canRepaint) ?? "";
      }
      return {
        code,
        /**
         * Every boundary this chunk *contains*, not just the one it is named
         * after. An entry chunk carries the catalogs of everything reachable
         * from the entry, so declaring only the entry's own inputs left an edit
         * to any other boundary's source invisible: the module was rebuilt for
         * nothing it embedded. See L-057.
         */
        watchedFiles: this.declaredInputsFor(`content:${loc}:${id}`, [bId, ...Object.keys(cat)]),
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
      code +=
        this._resolved.system.hmrSelfAcceptCode?.(
          `    if (newModule?.default && typeof globalThis !== "undefined" && globalThis.__zintl_active) {\n` +
            `      globalThis.__zintl_active.registerLoader(newModule.default.id, newModule.default.loader);\n` +
            `    }`,
        ) ?? "";
    } else {
      code += `export default ${managerObj};`;
    }
    return {
      code,
      // The manager inlines the active locale's catalog for every boundary it
      // serves, so its inputs are theirs too — same reason as the content
      // chunk above.
      watchedFiles: this.declaredInputsFor(`manager:${bakedLoc}:${id}`, [
        bId,
        ...Object.keys(catData),
      ]),
    };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Summarise why the boundaries sharing one catalog path are being written.
 *
 * Grouped catalogs mean one file can be reached by several boundaries with
 * different causes, so the summary is the distinct set rather than the first —
 * a merged catalog written for `delete` *and* `recover-missing` is a different
 * event from one written for either alone, and that distinction is the whole
 * reason this string exists (ledger L-071).
 */
function causeFor(writeCause: Map<string, string>, bIds: Set<string>): string | undefined {
  const causes = new Set<string>();
  for (const bId of bIds) {
    const cause = writeCause.get(bId);
    if (cause) causes.add(cause);
  }
  if (causes.size === 0) return undefined;
  return [...causes].sort().join("+");
}

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
  /**
   * Whether the runtime is being served for development.
   *
   * Defaults to `false` so a caller that forgets gets the production runtime:
   * the failure mode is "no debug output", never "debug machinery shipped to
   * users".
   */
  isDev = false,
  /**
   * Locales this project renders right-to-left, from
   * {@link ZintlCompiler.getRtlLocales}.
   *
   * Defaults to empty, and empty is meaningful rather than missing: the store
   * then leaves `dir` alone entirely instead of asserting `"ltr"` on documents
   * that never had the attribute.
   */
  rtlLocales: string[] = [],
  /**
   * Render an untranslated string as visibly-pseudo-localized text instead of
   * an empty one.
   *
   * Defaults to `false` for the same reason `isDev` does: a caller that forgets
   * gets the production behaviour. Meaningful only alongside `isDev`, since the
   * branch it controls sits inside the `__ZINTL_DEV__` guard.
   */
  pseudo = false,
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
  /**
   * Same mechanism, for the same reason: a word-boundary sentinel folds to a
   * literal the minifier can reason about, and it survives formatting.
   *
   * This deliberately replaced a regex that matched a TypeScript class-field
   * default (`sourceLocale: string = "en"`) in the runtime source. That worked
   * and was one `readonly` keyword, one formatter rule or one compile-target
   * change away from silently matching nothing — a substitution that fails by
   * doing nothing is the worst shape available, since the runtime still loads
   * and simply believes the wrong thing.
   */
  code = code.replace(/\b__ZINTL_RTL_LOCALES__\b/g, JSON.stringify(rtlLocales));
  /**
   * Same mechanism again. Folding to a literal `false` is what lets the
   * minifier drop both the branch and `pseudoLocalize` itself — a dev
   * affordance that shipped as dead weight would fail the rule it exists under.
   */
  code = code.replace(/\b__ZINTL_PSEUDO__\b/g, isDev && pseudo ? "true" : "false");
  return code;
}
