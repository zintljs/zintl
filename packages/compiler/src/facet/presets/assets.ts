import { join, isAbsolute, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ZintlFacet, CompilerContext } from "@zintljs/compiler";
import type { IOManager } from "@zintljs/compiler";
import type { CatalogManager } from "@zintljs/compiler";
import type { ZintlLogger } from "@zintljs/extractor";
import type { AssetTargetConfig } from "../../types/compiler.js";
import { sha1, generateMessageId } from "../../utils/hashing.js";
import { toPosixPath } from "../../utils/paths.js";

/**
 * This facet's name, exported so callers can refer to it without a string
 * literal.
 *
 * The plugin's `assetsTarget` and `virtualAssets` options configure *this*
 * facet and no other, so the plugin has to be able to say which one it means
 * when a project replaces it. Naming it through this constant keeps that a
 * reference rather than a guess — a renamed facet moves both ends at once.
 */
export const ASSETS_FACET_NAME = "system-static-assets";

/** Default asset extensions when the caller names none. */
const DEFAULT_ASSET_TARGETS: (string | AssetTargetConfig)[] = ["md", "txt"];

/**
 * Hive keys recording which path last carried a given source asset's bytes.
 *
 * The hive stores **identity, never content**. It used to hold whole localized
 * bodies — base64 for binaries — so that a moved source could have its
 * translation rebuilt at the new path, which is copying by another name. What a
 * move actually needs is the answer to "did this asset live somewhere else?",
 * and that is a hash and a path. Proposal 035 §5.2.
 */
const ASSET_IDENTITY_PREFIX = "@zintl/asset-id:";

/**
 * How a localized artifact's bytes reach the browser.
 *
 * Not a merge strategy, and not a property of the file format. `AssetMergeStrategy`
 * used to answer *how do we build the copy from its source* — deleted along with
 * copying itself — while quietly doubling as the discriminator for whether an
 * asset's content belonged in a catalog. Only that second question survives, and
 * it is answered by **the import**, never by the extension:
 *
 * - `import t from "./about.txt?raw"` asks for contents, so `"inline"`: the text
 *   becomes the catalog value like any other translation.
 * - `import u from "./hero.webp"` asks for a URL, so `"reference"`: the bundler
 *   emits and hashes the per-locale artifact as it would any asset.
 *
 * That is the bundler's own convention rather than a rule Zintl invented, so
 * there is no table of formats to configure and none that can go stale.
 * Proposal 035 §0.1.
 */
export type AssetDelivery = "inline" | "reference";

/** `?raw` / `?zintl-raw`, in any position of a query string. */
const CONTENT_QUERY = /[?&](raw|zintl-raw)(&|$)/;

/**
 * The marker that says *give me this exact file's URL and stay out of the way*.
 *
 * Zintl intercepts a plain import of a targeted asset, because a plain import is
 * a static binding and the whole point of targeting is that the answer changes
 * with the locale. The module it returns has to name the underlying files
 * somehow, and naming them plainly would be intercepted in turn — a module
 * importing itself through the thing that generated it.
 *
 * So the generated imports carry this, and the plugin declines anything wearing
 * it. Exactly the role `?zintl-raw` plays on the inline side, one delivery mode
 * over: a query is how an importer says which of two things it wants, and this
 * is the only spelling that cannot collide with a query a person wrote.
 */
const URL_QUERY = "zintl-url";

/**
 * Whether an import specifier asks for an asset's **contents** rather than a URL.
 *
 * One definition, shared by the compiler and the plugin, so the two halves of
 * the inline/reference decision cannot drift apart.
 */
export function isContentQuery(id: string): boolean {
  return CONTENT_QUERY.test(id);
}

/**
 * Whether this specifier is one Zintl generated to reach a file's own URL.
 *
 * The plugin declines these, so the bundler resolves them the way it resolves
 * any asset import. See {@link URL_QUERY}.
 */
export function isUrlQuery(id: string): boolean {
  return new RegExp(`[?&]${URL_QUERY}(&|$)`).test(id);
}

/** Tag a path so {@link isUrlQuery} recognises it. */
export function withUrlQuery(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${URL_QUERY}`;
}

/**
 * The extensions a target list *statically* claims, for the facet layer's
 * construction-time conflict detection.
 *
 * Only a pattern ending in a literal extension contributes — `"md"`,
 * `"**\/*.md"` and `"docs/**\/*.rst"` each declare one; `"docs/**\/*"` declares
 * nothing, because nothing about it is static.
 *
 * Declaring less than `match` matches is the intended shape rather than a gap:
 * the declaration buys the conflict check, and `match` stays the authority on
 * ownership.
 */
function declaredExtensions(targets: (string | AssetTargetConfig)[]): string[] {
  const out = new Set<string>();
  for (const item of targets) {
    const pattern = typeof item === "string" ? item : item?.targetPattern;
    if (!pattern) continue;
    const dotted = /\.([A-Za-z0-9_-]+)$/.exec(pattern);
    if (dotted) out.add(`.${dotted[1]}`);
    else if (!/[*?/]/.test(pattern)) out.add(`.${pattern}`);
  }
  return [...out];
}

export interface AssetFacetConfig {
  /**
   * Asset extensions or glob configs to localize.
   *
   * A bare extension like `"md"` expands to `**\/*.md`. Reached through the
   * plugin's `assetsTarget` option, which is the same list under the name that
   * makes sense from the outside.
   *
   * This concept used to be spelled three ways across the boundary: `targets`
   * here, `assetsTarget` on the same interface, and `assetsTarget` on the
   * plugin options — reconciled by an alias in the factory. One spelling now.
   *
   * @default ["md", "txt"]
   */
  targets?: (string | AssetTargetConfig)[];
  /**
   * Serve localized assets through virtual modules rather than resolving imports
   * straight to the artifact on disk.
   *
   * Artifacts are written either way — an author needs a file to fill — so this
   * chooses the delivery route and nothing else. It used to mean "do not write
   * to disk", which cannot survive scaffolding: the scaffold *is* the request
   * for a person to supply the variant.
   *
   * @default false
   */
  virtualAssets?: boolean;
}

/**
 * Manages localized artifacts for targeted static assets.
 *
 * Constructed only by the system content facet's `getManagerInstance` — never
 * instantiate directly. Exported as a type so consumers reading it back off
 * `ZintlCompiler.assets` (typed `unknown` at the compiler-core level, since the
 * core cannot know about specific facets) have something to narrow to.
 *
 * **A targeted asset is authored per locale, never derived.** This manager
 * scaffolds the slot, remembers the source's identity so a rename does not cost
 * an artifact, and reads back whatever a person put there. It never copies a
 * source into a localized path, never merges the two, and never compares them —
 * an English PDF at the German path is not a German PDF, and a source edit says
 * nothing about whether a translation fell behind. Proposal 035.
 */
export class AssetManager {
  private registeredAssets = new Map<string, AssetDelivery>();

  public getRegisteredAssetsRaw(): [string, AssetDelivery][] {
    return Array.from(this.registeredAssets.entries());
  }

  /**
   * Restore the registry from a previous run.
   *
   * Accepts bare ids as well as pairs, because a state file written before
   * delivery modes existed holds the former. Such an entry is taken as
   * `"reference"` — the same default a fresh registration gets, and one that the
   * first `?raw` import corrects.
   */
  public setRegisteredAssets(assets: (string | [string, AssetDelivery])[]) {
    this.registeredAssets = new Map(
      assets.map((entry) =>
        typeof entry === "string" ? ([entry, "reference"] as [string, AssetDelivery]) : entry,
      ),
    );
  }

  constructor(
    private readonly io: IOManager,
    private readonly root: string,
    private readonly sourceLocale: string,
    private readonly locales: string[],
    private readonly logger: ZintlLogger,
    private readonly catalog: CatalogManager,
    private readonly options: AssetFacetConfig = {},
    private readonly getDependencyGraph?: () => Record<string, any[]>,
    private readonly getHive?: () => Record<string, Record<string, any>>,
    private readonly markHiveDirty?: () => void,
    private readonly getBoundaryGraph?: () => {
      entries: Set<string>;
      nodes: Map<string, any>;
    } | null,
  ) {}

  private isAssetUsed(assetId: string): boolean {
    if (!this.getDependencyGraph) return true;
    const depGraph = this.getDependencyGraph();

    if (!depGraph || Object.keys(depGraph).length === 0) return true;

    const bg = this.getBoundaryGraph?.();
    if (bg && bg.entries.size === 0) return false;

    const normAssetId = toPosixPath(assetId);
    for (const deps of Object.values(depGraph)) {
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          if (dep && typeof dep.id === "string") {
            const cleanDepId = toPosixPath(dep.id.split("?")[0]);
            if (cleanDepId === normAssetId) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * The target this file matches, or `null`.
   *
   * Purely positional: which glob claimed the file, and where its artifacts go.
   * The `strategy` this used to carry — and the extension table that inferred one
   * when the project named none — described how to build a copy, and nothing is
   * built from a source any more.
   */
  public resolveAssetConfig(filePath: string): {
    targetPattern: string;
    outputPattern?: string;
  } | null {
    const absolutePath = isAbsolute(filePath) ? filePath : join(this.root, filePath);
    const relativePath = toPosixPath(relative(this.root, absolutePath));

    const assetsTarget = this.options.targets ?? DEFAULT_ASSET_TARGETS;

    for (const item of assetsTarget) {
      let targetPattern = "";
      let outputPattern: string | undefined;

      if (typeof item === "string") {
        targetPattern = item;
      } else if (item && typeof item === "object") {
        targetPattern = item.targetPattern;
        outputPattern = item.outputPattern;
      }

      if (!targetPattern) continue;

      let normalizedPattern = targetPattern;
      if (
        !targetPattern.includes("*") &&
        !targetPattern.includes("?") &&
        !targetPattern.includes("/")
      ) {
        const ext = targetPattern.startsWith(".") ? targetPattern : "." + targetPattern;
        normalizedPattern = `**/*${ext}`;
      }

      let escaped = normalizedPattern.replace(/\*\*\//g, "__DOUBLE_STAR_SLASH__");
      escaped = escaped.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      escaped = escaped.replace(/\*/g, "[^/]*");
      escaped = escaped.replace(/\?/g, "[^/]");
      escaped = escaped.replace(/__DOUBLE_STAR_SLASH__/g, "(?:.*/)?");
      const regex = new RegExp(`^${escaped}$`, "i");

      if (regex.test(relativePath)) {
        return { targetPattern, outputPattern };
      }
    }

    return null;
  }

  /**
   * Note that `filePath` is a targeted asset, and how its importer wants it.
   *
   * `delivery` is omitted by callers that saw the *file* rather than an import of
   * it — discovery walks and HMR events — and a known mode is never downgraded by
   * one of those. A first sighting with nothing to go on is `"reference"`, the
   * bundler's own default for a plain import; the first `?raw` import corrects it.
   */
  public async registerAsset(filePath: string, delivery?: AssetDelivery) {
    const absoluteOutputDir = isAbsolute(this.catalog.outputDir)
      ? this.catalog.outputDir
      : join(this.root, this.catalog.outputDir);

    const normalizedPath = toPosixPath(filePath);
    const normalizedOutputDir = toPosixPath(absoluteOutputDir);
    if (
      normalizedPath === normalizedOutputDir ||
      normalizedPath.startsWith(normalizedOutputDir + "/")
    ) {
      return;
    }

    const normalizedId = this.io.getNormalizedId(filePath);
    const known = this.registeredAssets.get(normalizedId);
    const next = delivery ?? known ?? "reference";
    /**
     * `"inline"` is sticky. One asset imported both ways gets one catalog entry,
     * and content is the answer that serves both readers: a `?raw` import needs
     * the text and cannot reconstruct it from a URL.
     */
    this.registeredAssets.set(
      normalizedId,
      known === "inline" || next === "inline" ? "inline" : next,
    );

    await this.syncSingleAsset(normalizedId);
  }

  /**
   * How this asset's importers want it: the contents, or a URL.
   *
   * Read from the **dependency graph** rather than from whatever the last
   * registration happened to say, because registration order is not something
   * this can depend on. A catalog chunk is generated before some of the modules
   * that import into it have been resolved, so an asset asked at the wrong
   * moment answered `"reference"` and shipped a URL where a `?raw` consumer
   * needed text — four asset scenarios caught exactly that.
   *
   * The graph is the right source and already holds the answer: it records the
   * import specifier verbatim, query and all (`src/about.txt?raw`), which is the
   * same fact {@link isAssetUsed} reads one field over.
   *
   * `"inline"` wins a mixed asset. A `?raw` consumer needs the text and cannot
   * reconstruct it from a URL, while nothing stops a URL consumer being served
   * by an asset whose content is also carried.
   */
  /** The project-relative id this manager keys an asset by. */
  public normalizedId(filePath: string): string {
    return this.io.getNormalizedId(filePath);
  }

  public getDelivery(assetId: string): AssetDelivery {
    const depGraph = this.getDependencyGraph?.();
    if (depGraph) {
      const normAssetId = toPosixPath(assetId);
      for (const deps of Object.values(depGraph)) {
        if (!Array.isArray(deps)) continue;
        for (const dep of deps) {
          if (!dep || typeof dep.id !== "string") continue;
          if (toPosixPath(dep.id.split("?")[0]) !== normAssetId) continue;
          if (isContentQuery(dep.id)) return "inline";
        }
      }
    }
    /**
     * What the plugin observed while resolving, for a graph that has not been
     * built yet — and the reason `registerAsset` still records anything.
     */
    return this.registeredAssets.get(assetId) ?? "reference";
  }

  /**
   * Ensure every locale of `assetId` has a slot, and follow the source if it moved.
   *
   * The whole of what the compiler does with a targeted asset's content, which is
   * nothing. An artifact that does not exist is created **empty**; one that exists
   * is left exactly as its author left it.
   *
   * Empty rather than a copy of the source, because a byte-identical file is a
   * source-locale fallback wearing a scaffold's clothes: nothing downstream can
   * tell an untouched one from a deliberate decision, so the build gate has
   * nothing to test and ships the source bytes as a translation. A zero-byte file
   * cannot be mistaken for finished work, and it tells the author the exact path
   * to produce — the one thing the compiler is in a position to know.
   * Proposal 035 §5.1.
   */
  public async syncSingleAsset(assetId: string) {
    if (!this.isAssetUsed(assetId)) return;

    const config = this.resolveAssetConfig(assetId);
    if (!config) return;

    const originalPath = join(this.root, assetId);
    if (!(await this.io.exists(originalPath))) return;

    await this.followMove(assetId, originalPath);

    for (const locale of this.locales) {
      if (locale === this.sourceLocale) continue;
      const destPath = this.getAssetPath(assetId, locale);
      if (await this.io.exists(destPath)) continue;
      await this.io.safeWriteFile(destPath, "");
    }
  }

  /**
   * Move a source asset's artifacts to follow it, so a rename never costs one.
   *
   * Identity is the source file's content hash, and the hive remembers which path
   * last carried it. Restructuring a directory must not orphan a German PDF
   * somebody commissioned, exactly as it must not orphan a translation — identity
   * is content-based everywhere else in this project, and an asset slot is no
   * different.
   *
   * The three observable cases are 035 §5.2's table, and only the first acts:
   *
   * | Observed            | Meaning          | Action                                          |
   * | :------------------ | :--------------- | :---------------------------------------------- |
   * | Same hash, new path | Moved or renamed | Move the artifacts to follow                    |
   * | Same path, new hash | Edited in place  | Nothing — a source edit says nothing about a translation |
   * | New hash, new path  | Ambiguous        | Treat as new; leave the old artifacts alone     |
   *
   * Nothing is ever deleted, so a wrong guess costs an orphaned file a person can
   * move rather than content a person cannot recover. An artifact already present
   * at the destination wins over the one being followed, for the same reason: it
   * is the one somebody most recently authored.
   */
  private async followMove(assetId: string, originalPath: string): Promise<void> {
    const hive = this.getHive?.();
    if (!hive) return;

    const bucket = (hive[this.sourceLocale] ??= {});
    const key = `${ASSET_IDENTITY_PREFIX}${sha1(await this.io.readBuffer(originalPath))}`;
    const previousId = bucket[key];

    if (typeof previousId === "string" && previousId !== assetId) {
      for (const locale of this.locales) {
        if (locale === this.sourceLocale) continue;
        const from = this.getAssetPath(previousId, locale);
        const to = this.getAssetPath(assetId, locale);
        if (from === to) continue;
        if (!(await this.io.exists(from))) continue;
        if (await this.io.exists(to)) continue;
        await this.io.safeWriteBuffer(to, await this.io.readBuffer(from));
        await this.io.rm(from);
        this.logger.debug(`[Assets] Source moved; artifact followed: ${from} -> ${to}`);
      }
    }

    let dirty = false;
    /**
     * One identity per asset. An in-place edit mints a new hash, and the key it
     * replaces would otherwise accumulate for the lifetime of the project.
     */
    for (const [k, v] of Object.entries(bucket)) {
      if (k !== key && k.startsWith(ASSET_IDENTITY_PREFIX) && v === assetId) {
        delete bucket[k];
        dirty = true;
      }
    }
    if (bucket[key] !== assetId) {
      bucket[key] = assetId;
      dirty = true;
    }
    if (dirty) this.markHiveDirty?.();
  }

  public getRegisteredAssets(): string[] {
    return Array.from(this.registeredAssets.keys()).filter((assetId) => this.isAssetUsed(assetId));
  }

  public isSupportedAsset(filePath: string): boolean {
    return this.resolveAssetConfig(filePath) !== null;
  }

  public getAssetExtension(id: string): string {
    const idx = id.lastIndexOf(".");
    return idx !== -1 ? id.substring(idx) : ".txt";
  }

  public getTranslationOnly(content: string): string {
    return content;
  }

  public getAssetPath(id: string, locale: string): string {
    const ext = this.getAssetExtension(id);
    const config = this.resolveAssetConfig(id);

    if (config?.outputPattern) {
      const lastSlash = id.lastIndexOf("/");
      const dir = lastSlash !== -1 ? id.substring(0, lastSlash) : "";
      const filename = lastSlash !== -1 ? id.substring(lastSlash + 1) : id;
      const cleanName = filename.endsWith(ext)
        ? filename.substring(0, filename.length - ext.length)
        : filename;

      let formatted = config.outputPattern
        .replace(/\[locales?\]/g, locale)
        .replace(/\[name\]/g, cleanName)
        .replace(/\[dir\]/g, dir)
        .replace(/\[ext\]/g, ext.startsWith(".") ? ext.substring(1) : ext);

      formatted = formatted.replace(/\/+/g, "/");
      return isAbsolute(formatted) ? formatted : join(this.root, formatted);
    }

    const hasCatalogFormat = !!this.catalog.catalogFormat;
    const isMultilingual =
      hasCatalogFormat && !(this.catalog.catalogFormat as string).includes("[locale]");

    if (!hasCatalogFormat || isMultilingual) {
      const baseDir = isAbsolute(this.catalog.outputDir)
        ? this.catalog.outputDir
        : join(this.root, this.catalog.outputDir);

      const cleanId = id.endsWith(ext) ? id.substring(0, id.length - ext.length) : id;
      return join(baseDir, `${cleanId}.${locale}${ext}`);
    }

    const defaultCatalogPath = this.catalog.getCatalogPath(id, locale)!;
    if (defaultCatalogPath.endsWith(".json")) {
      let result = defaultCatalogPath.replace(/\.json$/, ext);
      if (result.endsWith(`${ext}.${locale}${ext}`)) {
        result = result.replace(new RegExp(`\\${ext}\\.${locale}\\${ext}$`), `.${locale}${ext}`);
      } else if (result.endsWith(`${ext}${ext}`)) {
        result = result.substring(0, result.length - ext.length);
      }
      return result;
    }
    return defaultCatalogPath + ext;
  }

  public async syncAssets(_locales: string[]) {
    const assets = this.getRegisteredAssets();
    this.logger.debug(`Syncing static assets (${assets.length} files)`);
    for (const assetId of assets) {
      await this.syncSingleAsset(assetId);
    }
  }

  public async getActiveAssetPaths(locales: string[]): Promise<Set<string>> {
    const paths = new Set<string>();
    const toRemove = new Set<string>();

    for (const assetId of this.getRegisteredAssets()) {
      const originalPath = join(this.root, assetId);
      if (!(await this.io.exists(originalPath))) {
        toRemove.add(assetId);
        continue;
      }

      for (const locale of locales) {
        if (locale === this.sourceLocale) continue;
        const p = this.getAssetPath(assetId, locale);
        if (p) paths.add(p);
      }
    }

    for (const assetId of toRemove) {
      for (const locale of locales) {
        if (locale === this.sourceLocale) continue;
        const p = this.getAssetPath(assetId, locale);
        if (p && (await this.io.exists(p))) {
          await this.io.rm(p);
          this.logger.debug(`Pruned orphaned asset target: ${p}`);
        }
      }
      this.registeredAssets.delete(assetId);
    }

    return paths;
  }

  /**
   * Every slot nobody has filled yet.
   *
   * The asset half of `verifyIntegrity`, and the same statement it already makes
   * about strings: an empty catalog entry is a missing translation, and
   * `size === 0` is that statement about a file. One rule, two representations
   * (035 §5.1).
   *
   * Stat rather than read, so gating a directory of videos costs a directory
   * listing. Absence counts as unfilled too — an artifact deleted by hand is a
   * slot to fill, not permission to ship the source.
   */
  public async getUnfilledOutputs(locales: string[]): Promise<{ locale: string; path: string }[]> {
    const unfilled: { locale: string; path: string }[] = [];
    for (const assetId of this.getRegisteredAssets()) {
      if (!(await this.io.exists(join(this.root, assetId)))) continue;
      for (const locale of locales) {
        if (locale === this.sourceLocale) continue;
        const path = this.getAssetPath(assetId, locale);
        if (!(await this.io.exists(path))) {
          unfilled.push({ locale, path });
          continue;
        }
        const stats = await this.io.stat(path);
        if (!stats || stats.size === 0) unfilled.push({ locale, path });
      }
    }
    return unfilled;
  }

  /**
   * Whether `filePath` is one locale's artifact, answered without side effects.
   *
   * {@link isLocalizedAsset} answers the same question through
   * `getActiveAssetPaths`, which *prunes* as it goes — fine for the pruning
   * pass it was written for, wrong inside a `load` hook that only wants to know
   * what it is holding.
   */
  public isLocalizedArtifact(filePath: string): boolean {
    const normalized = this.io.getNormalizedId(filePath);
    for (const assetId of this.registeredAssets.keys()) {
      for (const locale of this.locales) {
        if (locale === this.sourceLocale) continue;
        if (this.io.getNormalizedId(this.getAssetPath(assetId, locale)) === normalized) return true;
      }
    }
    return false;
  }

  public async isLocalizedAsset(filePath: string): Promise<boolean> {
    const normalized = this.io.getNormalizedId(filePath);
    const paths = await this.getActiveAssetPaths(this.locales);

    for (const p of paths) {
      if (this.io.getNormalizedId(p) === normalized) return true;
    }
    return false;
  }

  /**
   * The catalog contribution for `locale` — inline assets only.
   *
   * A reference asset's catalog value is a URL the bundler mints, produced by
   * `getChunkContributions` rather than read here; there is no content of it to
   * carry.
   *
   * An unfilled inline artifact contributes `""` rather than the source text.
   * That is the no-fallback rule applied to content: the empty string is what
   * `verifyIntegrity` already reads as "missing", so an unfilled asset fails a
   * build for the same reason and with the same wording as an unfilled string
   * instead of shipping the source locale's bytes to a reader who asked for
   * another language.
   */
  public async getAssetTranslations(locale: string): Promise<Record<string, string>> {
    const translations: Record<string, string> = {};
    for (const assetId of this.getRegisteredAssets()) {
      if (this.getDelivery(assetId) !== "inline") continue;

      const key = `@zintl/asset:${assetId}`;
      if (locale === this.sourceLocale) {
        const originalPath = join(this.root, assetId);
        if (await this.io.exists(originalPath)) {
          translations[key] = await this.io.readFile(originalPath);
        }
        continue;
      }

      const localizedPath = this.getAssetPath(assetId, locale);
      translations[key] = (await this.io.exists(localizedPath))
        ? await this.io.readFile(localizedPath)
        : "";
    }
    return translations;
  }
}

/**
 * Localization of static content files — Markdown, text, PDFs, video, whatever
 * you point it at.
 *
 * Each matched file gets an **empty** artifact per locale, and a person fills it.
 * Zintl never translates one into existence and never copies the source across:
 * localization is not translation, and a German legal PDF, a dubbed audio track
 * and a right-to-left poster are not transformations of their English
 * counterparts. Import the file as usual and you receive the artifact for the
 * active locale.
 *
 * The import decides how it arrives — `?raw` for the contents, a plain import for
 * a URL — so no file format is special and none needs naming.
 *
 * Identity is tracked by content, so moving or renaming a source carries its
 * artifacts with it. Nothing else about a source edit reaches them: whether a
 * translation has fallen behind is an editorial question, and a compiler that can
 * only see that bytes differ is the wrong thing to ask.
 *
 * Included in the built-in set, configured from the plugin's `assetsTarget` and
 * `virtualAssets` options. Proposal 035.
 */
export function assetsFacet(config: AssetFacetConfig = {}): ZintlFacet {
  let manager: AssetManager;

  const resolvedConfig = { ...config };

  const getManager = (context: CompilerContext) => {
    if (!manager) {
      manager = new AssetManager(
        context.io,
        context.root,
        context.sourceLocale,
        context.locales,
        context.logger,
        context.catalog,
        resolvedConfig,
        context.getDependencyGraph,
        context.getHive,
        context.markHiveDirty,
        context.getBoundaryGraph,
      );
    }
    return manager;
  };

  return {
    name: ASSETS_FACET_NAME,
    concern: "content",
    priority: 100,
    extensions: declaredExtensions(resolvedConfig.targets ?? DEFAULT_ASSET_TARGETS),
    getManagerInstance(context: CompilerContext) {
      return getManager(context);
    },
    virtualBoundaries: ["b_assets"],
    match(filePath: string, context?: CompilerContext) {
      if (!context) {
        const idx = filePath.lastIndexOf(".");
        const ext = idx !== -1 ? filePath.substring(idx) : "";
        const targets = resolvedConfig.targets ?? DEFAULT_ASSET_TARGETS;
        return targets.some((t: any) => {
          if (typeof t === "string") {
            return ext === (t.startsWith(".") ? t : `.${t}`);
          }
          return false;
        });
      }
      return getManager(context).isSupportedAsset(filePath);
    },
    setup(savedState: any, context: CompilerContext) {
      if (savedState && Array.isArray(savedState)) {
        getManager(context).setRegisteredAssets(savedState);
      }
    },
    async discover(filePath: string, context: CompilerContext) {
      await getManager(context).registerAsset(filePath);
    },
    async flush(context: CompilerContext) {
      await getManager(context).syncAssets(context.locales);
    },
    async getTranslations(locale: string, context: CompilerContext) {
      return getManager(context).getAssetTranslations(locale);
    },
    async isLocalizedOutput(filePath: string, context: CompilerContext) {
      return getManager(context).isLocalizedAsset(filePath);
    },
    async getActiveOutputPaths(context: CompilerContext) {
      return getManager(context).getActiveAssetPaths(context.locales);
    },
    deliversUrl(filePath: string, context: CompilerContext) {
      const mgr = getManager(context);
      if (!mgr.isSupportedAsset(filePath)) return false;
      // An artifact is already one locale's answer; there is nothing to follow.
      if (mgr.isLocalizedArtifact(filePath)) return false;
      return mgr.getDelivery(mgr.normalizedId(filePath)) === "reference";
    },
    async getUnfilledOutputs(context: CompilerContext) {
      return getManager(context).getUnfilledOutputs(context.locales);
    },
    getStateToSave(context: CompilerContext) {
      return getManager(context).getRegisteredAssetsRaw();
    },
    /**
     * The source asset and every localized copy of it, for `b_assets`.
     *
     * Sources as well as outputs: a developer editing `about.txt` and a
     * translator editing `about.ar.txt` both change what the catalog says, and
     * a host that watches only one of them delivers half the feature.
     */
    getDeclaredInputs(context: CompilerContext) {
      const mgr = getManager(context);
      const paths: string[] = [];
      for (const assetId of mgr.getRegisteredAssets()) {
        paths.push(join(context.root, assetId));
        for (const locale of context.locales) {
          if (locale === context.sourceLocale) continue;
          paths.push(mgr.getAssetPath(assetId, locale));
        }
      }
      return paths;
    },
    async getBoundaryForLocalizedOutput(filePath: string, context: CompilerContext) {
      const mgr = getManager(context);
      if (await mgr.isLocalizedAsset(filePath)) {
        return "b_assets";
      }
      return null;
    },
    getChunkContributions(locale: string, context: CompilerContext) {
      const mgr = getManager(context);
      const registeredAssets = mgr.getRegisteredAssets();
      const imports: string[] = [];
      const catalog: Record<string, any> = {};
      let assetCounter = 0;
      for (const assetId of registeredAssets) {
        const isSource = locale === context.sourceLocale;
        const localizedPath = isSource
          ? join(context.root, assetId)
          : mgr.getAssetPath(assetId, locale);
        if (!existsSync(localizedPath)) continue;

        const assetKey = context.isDev
          ? `@zintl/asset:${assetId}`
          : generateMessageId(`@zintl/asset:${assetId}`);
        const varName = `_zintl_asset_${assetCounter++}`;

        /**
         * **A reference is a URL, in dev and in production alike.**
         *
         * A plain import of the artifact is all this takes: the bundler emits the
         * per-locale file, hashes it, and hands back the URL, which becomes the
         * catalog value like any other string. Every mechanism downstream —
         * chunking, hydration, runtime locale switching, hot updates — then works
         * on a PDF or a video without knowing it is one, because a URL is a
         * string.
         *
         * No `emitFile`, and so no host-specific code: emitting an asset is the
         * one thing every bundler already does.
         */
        if (mgr.getDelivery(assetId) === "reference") {
          imports.push(`import ${varName} from "${withUrlQuery(toPosixPath(localizedPath))}";`);
          catalog[assetKey] = { __zintl_pre_serialized: true, code: varName };
          continue;
        }

        if (context.isDev) {
          /**
           * **Inlined in development, imported in production.**
           *
           * The import is right for a build: one module per asset, shared by
           * every chunk that needs it, and the text is not duplicated per
           * locale chunk. In dev it was the whole of ZHMR §5's failure
           * (ledger L-067). The imported module holds the text, the content
           * module embeds its default export into a catalog object literal at
           * evaluation time, and the two go stale independently — so an asset
           * edit rebuilt the content module perfectly around a value it read
           * from a module neither host had rebuilt. Fixing that per host
           * means chasing it twice, in two mechanisms that share nothing:
           * Vite mints the raw module under a *virtual*, extension-free id
           * (L-009) that its graph cannot associate with the changed file at
           * all, and Rspack rebuilds from declared dependencies the raw
           * module has no way to restate.
           *
           * Inlining deletes the second module rather than synchronising it.
           * The content module is the one both hosts already rebuild
           * correctly on an asset edit, so putting the text where the catalog
           * is makes the update arrive by the same route as every other
           * translation — and one less route is the fix.
           *
           * Dev-only, so nothing about the built output changes: bundle size
           * is not a dev concern, and duplicating a `.md` file across locale
           * chunks in production would be a real cost.
           */
          catalog[assetKey] = mgr.getTranslationOnly(readFileSync(localizedPath, "utf-8"));
          continue;
        }

        imports.push(`import ${varName} from "${toPosixPath(localizedPath)}?zintl-raw";`);
        catalog[assetKey] = { __zintl_pre_serialized: true, code: varName };
      }
      return { imports, boundaryId: "b_assets", catalog };
    },
  };
}
