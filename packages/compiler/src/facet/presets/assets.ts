import { join, isAbsolute, relative } from "node:path";
import { existsSync } from "node:fs";
import type { ZintlFacet, CompilerContext } from "@zintljs/compiler";
import type { IOManager } from "@zintljs/compiler";
import type { CatalogManager } from "@zintljs/compiler";
import type { ZintlLogger } from "@zintljs/extractor";
import type { AssetMergeStrategy, AssetTargetConfig } from "../../types/compiler.js";
import { sha1, generateMessageId } from "../../utils/hashing.js";
import { similarity } from "../../reconcile.js";
import { toPosixPath } from "../../utils/paths.js";

/**
 * How similar an asset's source body must be to a remembered one before its
 * translation is reused.
 *
 * Deliberately its own constant rather than `DEFAULT_RENAME_THRESHOLD`. That one
 * answers "is this the same UI string, edited?" over short labels; this one
 * answers "did this document change materially?" over whole file bodies. They
 * happen to share a value today, and they should be free to diverge.
 */
const DEFAULT_ASSET_DRIFT_THRESHOLD = 0.6;

/** Default asset extensions when the caller names none. */
const DEFAULT_ASSET_TARGETS: (string | AssetTargetConfig)[] = ["md", "txt"];

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
   * Serve localized assets from virtual modules instead of writing them to disk.
   *
   * @default false
   */
  virtualAssets?: boolean;
  /**
   * How similar an asset's body must be to the remembered one before its
   * translation is reused.
   *
   * Its own knob, separate from the plugin's `similarityThreshold`: that one
   * asks "is this the same UI string, edited?" over short labels, this one asks
   * "did this document change materially?" over whole file bodies.
   *
   * @default 0.6
   */
  similarityThreshold?: number;
}

/**
 * Manages translation for static assets like Markdown (.md) and Text (.txt) files.
 *
 * Constructed only by the system content facet's `getManagerInstance` — never
 * instantiate directly. Exported as a type so consumers reading it back off
 * `ZintlCompiler.assets` (typed `unknown` at the compiler-core level, since the
 * core cannot know about specific facets) have something to narrow to.
 */
export class AssetManager {
  private registeredAssets = new Set<string>();

  public getRegisteredAssetsRaw(): string[] {
    return Array.from(this.registeredAssets);
  }

  public setRegisteredAssets(assets: string[]) {
    this.registeredAssets = new Set(assets);
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

  public resolveAssetConfig(filePath: string): {
    targetPattern: string;
    strategy: AssetMergeStrategy;
    outputPattern?: string;
  } | null {
    const absolutePath = isAbsolute(filePath) ? filePath : join(this.root, filePath);
    const relativePath = toPosixPath(relative(this.root, absolutePath));

    const assetsTarget = this.options.targets ?? DEFAULT_ASSET_TARGETS;

    for (const item of assetsTarget) {
      let targetPattern = "";
      let strategy: AssetMergeStrategy | undefined;
      let outputPattern: string | undefined;

      if (typeof item === "string") {
        targetPattern = item;
      } else if (item && typeof item === "object") {
        targetPattern = item.targetPattern;
        strategy = item.strategy;
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
        if (!strategy) {
          const lower = relativePath.toLowerCase();
          if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
            strategy = "frontmatter";
          } else if (lower.endsWith(".txt")) {
            strategy = "text-passthrough";
          } else {
            strategy = "binary-passthrough";
          }
        }

        return {
          targetPattern,
          strategy,
          outputPattern,
        };
      }
    }

    return null;
  }

  public async registerAsset(filePath: string) {
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
    this.registeredAssets.add(normalizedId);

    await this.syncSingleAsset(normalizedId);
  }

  public async syncSingleAsset(assetId: string) {
    if (!this.isAssetUsed(assetId)) return;

    const config = this.resolveAssetConfig(assetId);
    if (!config) return;

    const originalPath = join(this.root, assetId);
    if (!(await this.io.exists(originalPath))) return;

    let sourceContent = "";
    let sourceBuffer: Buffer | null = null;
    let sourceHashKey = "";
    let sourceChanged = false;
    let similarityScore = 1;

    if (config.strategy === "binary-passthrough") {
      sourceBuffer = await this.io.readBuffer(originalPath);
      sourceHashKey = `@zintl/asset-hash:${sha1(sourceBuffer)}`;
    } else {
      sourceContent = await this.io.readFile(originalPath);
      const body = this.getAssetBody(sourceContent, this.getAssetExtension(assetId));
      sourceHashKey = `@zintl/asset-hash:${sha1(body)}`;

      const hive = this.getHive?.();
      const lastSource = hive?.[this.sourceLocale]?.[`@zintl/asset:${assetId}`];
      if (lastSource !== undefined) {
        const ext = this.getAssetExtension(assetId);
        const currentBody = this.getAssetBody(sourceContent, ext);
        const lastBody = this.getAssetBody(lastSource, ext);
        sourceChanged = currentBody !== lastBody;
        if (sourceChanged) {
          similarityScore = similarity(lastBody, currentBody);
        }
      }
    }

    const hive = this.getHive?.();

    for (const locale of this.locales) {
      if (locale === this.sourceLocale) continue;

      const destPath = this.getAssetPath(assetId, locale);
      let hiveBackup = hive?.[locale]?.[sourceHashKey];
      let isFuzzyMatched = false;

      if (!hiveBackup && hive && config.strategy !== "binary-passthrough") {
        const threshold = this.options.similarityThreshold ?? DEFAULT_ASSET_DRIFT_THRESHOLD;
        let bestScore = 0;
        let bestKey = "";

        const sourceKeys = Object.keys(hive[this.sourceLocale] || {}).filter((k) =>
          k.startsWith("@zintl/asset-hash:"),
        );

        const ext = this.getAssetExtension(assetId);
        const currentBody = this.getAssetBody(sourceContent, ext);

        for (const key of sourceKeys) {
          const oldSourceContent = hive[this.sourceLocale][key];
          if (typeof oldSourceContent === "string") {
            const oldSourceBody = this.getAssetBody(oldSourceContent, ext);
            const score = similarity(oldSourceBody, currentBody);
            if (score >= threshold && score > bestScore) {
              bestScore = score;
              bestKey = key;
            }
          }
        }

        if (bestKey) {
          const fuzzyBackupContent = hive[locale]?.[bestKey];
          if (fuzzyBackupContent) {
            hiveBackup = fuzzyBackupContent;
            isFuzzyMatched = true;
          }
        }
      }

      if (config.strategy === "binary-passthrough") {
        let targetBuffer: Buffer | null = null;
        if (await this.io.exists(destPath)) {
          targetBuffer = await this.io.readBuffer(destPath);
        }

        if (targetBuffer) {
          if (sourceBuffer && !targetBuffer.equals(sourceBuffer)) {
            if (hive) {
              let dirty = false;
              if (!hive[locale]) hive[locale] = {};
              const base64 = targetBuffer.toString("base64");
              if (hive[locale][sourceHashKey] !== base64) {
                hive[locale][sourceHashKey] = base64;
                dirty = true;
              }
              if (!hive[this.sourceLocale]) hive[this.sourceLocale] = {};
              const sourceBase64 = sourceBuffer.toString("base64");
              if (hive[this.sourceLocale][sourceHashKey] !== sourceBase64) {
                hive[this.sourceLocale][sourceHashKey] = sourceBase64;
                dirty = true;
              }
              if (dirty) {
                this.markHiveDirty?.();
              }
            }
          }
        } else if (hiveBackup) {
          const buffer = Buffer.from(hiveBackup, "base64");
          if (!this.options.virtualAssets) {
            await this.io.safeWriteBuffer(destPath, buffer);
          }
        } else if (sourceBuffer) {
          if (!this.options.virtualAssets) {
            await this.io.safeWriteBuffer(destPath, sourceBuffer);
          }
        }
      } else {
        let merged: string;
        let existingContent = "";
        if (await this.io.exists(destPath)) {
          existingContent = await this.io.readFile(destPath);
        }

        if (existingContent) {
          const isTranslated =
            existingContent.trim() !== "" &&
            existingContent !== sourceContent &&
            !existingContent.includes("[ZINTL WARNING]");
          if (isTranslated) {
            if (hive) {
              let dirty = false;
              if (!hive[locale]) hive[locale] = {};
              if (hive[locale][sourceHashKey] !== existingContent) {
                hive[locale][sourceHashKey] = existingContent;
                dirty = true;
              }
              if (!hive[this.sourceLocale]) hive[this.sourceLocale] = {};
              if (hive[this.sourceLocale][sourceHashKey] !== sourceContent) {
                hive[this.sourceLocale][sourceHashKey] = sourceContent;
                dirty = true;
              }
              if (dirty) {
                this.markHiveDirty?.();
              }
            }
          }

          if (sourceChanged) {
            const threshold = this.options.similarityThreshold ?? DEFAULT_ASSET_DRIFT_THRESHOLD;
            const isFuzzy = similarityScore >= threshold;

            if (isFuzzy) {
              this.logger.warn(
                `[Assets] Source asset "${assetId}" changed slightly. Localized target for "${locale}" has been preserved with a warning.`,
              );
              const ext = this.getAssetExtension(assetId).toLowerCase();
              const warning = "Source content has changed slightly. Please review translation.";

              if (ext === ".md" || ext === ".mdx") {
                const { frontmatter } = this.parseFrontmatter(existingContent);
                const { frontmatter: sourceFM } = this.parseFrontmatter(sourceContent);
                const mergedFM = this.mergeFrontmatter(sourceFM, frontmatter);
                const fmPrefix = this.stringifyFrontmatter(mergedFM);
                const body = this.getAssetBody(existingContent, ext);
                const cleanBody = body.replace(/^<!-- \[ZINTL WARNING\] .*? -->\n\n/, "");
                merged = `${fmPrefix}<!-- [ZINTL WARNING] ${warning} -->\n\n${cleanBody}`;
              } else {
                const cleanBody = existingContent.replace(/^\[ZINTL WARNING:.*?\]\n\n/, "");
                merged = `[ZINTL WARNING: ${warning}]\n\n${cleanBody}`;
              }
            } else {
              this.logger.warn(
                `[Assets] Source asset "${assetId}" changed significantly. Localized target for "${locale}" has been marked as outdated.`,
              );
              const ext = this.getAssetExtension(assetId).toLowerCase();
              const warning = "Source content has changed. Please re-translate.";
              if (ext === ".md" || ext === ".mdx") {
                const { frontmatter, body } = this.parseFrontmatter(sourceContent);
                const fmPrefix = this.stringifyFrontmatter(frontmatter);
                merged = `${fmPrefix}<!-- [ZINTL WARNING] ${warning} -->\n\n${body}`;
              } else {
                merged = `[ZINTL WARNING: ${warning}]\n\n${sourceContent}`;
              }
            }
          } else {
            if (typeof config.strategy === "function") {
              const srcBuf = Buffer.from(sourceContent, "utf-8");
              const extBuf = Buffer.from(existingContent, "utf-8");
              const resBuf = config.strategy(srcBuf, extBuf, locale);
              merged = resBuf.toString("utf-8");
            } else if (config.strategy === "text-passthrough") {
              merged = existingContent;
            } else {
              merged = this.mergeContent(
                sourceContent,
                existingContent,
                this.getAssetExtension(assetId),
                locale,
              );
            }
          }
        } else if (hiveBackup) {
          if (isFuzzyMatched) {
            const ext = this.getAssetExtension(assetId).toLowerCase();
            const warning = "Source content has changed slightly. Please review translation.";
            const body = this.getAssetBody(hiveBackup, ext);

            if (ext === ".md" || ext === ".mdx") {
              const { frontmatter } = this.parseFrontmatter(hiveBackup);
              const { frontmatter: sourceFM } = this.parseFrontmatter(sourceContent);
              const mergedFM = this.mergeFrontmatter(sourceFM, frontmatter);
              const fmPrefix = this.stringifyFrontmatter(mergedFM);
              const cleanBody = body.replace(/^<!-- \[ZINTL WARNING\] .*? -->\n\n/, "");
              merged = `${fmPrefix}<!-- [ZINTL WARNING] ${warning} -->\n\n${cleanBody}`;
            } else {
              const cleanBody = body.replace(/^\[ZINTL WARNING:.*?\]\n\n/, "");
              merged = `[ZINTL WARNING: ${warning}]\n\n${cleanBody}`;
            }
          } else {
            merged = hiveBackup;
          }
        } else {
          merged = sourceContent;
        }

        if (!this.options.virtualAssets) {
          await this.io.safeWriteFile(destPath, merged);
        }
      }
    }
  }

  public getRegisteredAssets(): string[] {
    return Array.from(this.registeredAssets).filter((assetId) => this.isAssetUsed(assetId));
  }

  public isSupportedAsset(filePath: string): boolean {
    return this.resolveAssetConfig(filePath) !== null;
  }

  public getAssetExtension(id: string): string {
    const idx = id.lastIndexOf(".");
    return idx !== -1 ? id.substring(idx) : ".txt";
  }

  public getTranslationOnly(content: string, _ext: string): string {
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

  private getAssetBody(content: string, ext: string): string {
    const lower = ext.toLowerCase();
    if (lower === ".md" || lower === ".mdx") {
      return this.parseFrontmatter(content).body.trim();
    }
    return content.trim();
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (match) {
      const yaml = match[1];
      const body = content.substring(match[0].length);
      const frontmatter: Record<string, string> = {};
      const lines = yaml.split("\n");
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx !== -1) {
          const key = line.substring(0, idx).trim();
          const val = line.substring(idx + 1).trim();
          frontmatter[key] = val;
        }
      }
      return { frontmatter, body };
    }
    return { frontmatter: {}, body: content };
  }

  private stringifyFrontmatter(frontmatter: Record<string, string>): string {
    if (Object.keys(frontmatter).length === 0) return "";
    let yaml = "---\n";
    for (const [k, v] of Object.entries(frontmatter)) {
      yaml += `${k}: ${v}\n`;
    }
    yaml += "---\n";
    return yaml;
  }

  private mergeFrontmatter(
    source: Record<string, string>,
    target: Record<string, string>,
  ): Record<string, string> {
    const merged = { ...source };
    for (const [k, v] of Object.entries(target)) {
      if (v !== undefined) {
        merged[k] = v;
      }
    }
    return merged;
  }

  public mergeContent(
    sourceBody: string,
    targetFullContent: string,
    _ext: string,
    _locale: string,
  ): string {
    const { frontmatter: sourceFM, body: sourceRawBody } = this.parseFrontmatter(sourceBody);

    if (!targetFullContent.trim()) {
      const fmPrefix = this.stringifyFrontmatter(sourceFM);
      return `${fmPrefix}${sourceRawBody}`;
    }

    const { frontmatter: targetFM, body: targetBody } = this.parseFrontmatter(targetFullContent);
    const mergedFM = this.mergeFrontmatter(sourceFM, targetFM);
    const fmPrefix = this.stringifyFrontmatter(mergedFM);

    return `${fmPrefix}${targetBody}`;
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

  public async isLocalizedAsset(filePath: string): Promise<boolean> {
    const normalized = this.io.getNormalizedId(filePath);
    const paths = await this.getActiveAssetPaths(this.locales);

    for (const p of paths) {
      if (this.io.getNormalizedId(p) === normalized) return true;
    }
    return false;
  }

  public async getAssetTranslations(locale: string): Promise<Record<string, string>> {
    const translations: Record<string, string> = {};
    for (const assetId of this.getRegisteredAssets()) {
      const config = this.resolveAssetConfig(assetId);
      if (config?.strategy === "binary-passthrough") {
        continue;
      }
      const key = `@zintl/asset:${assetId}`;
      if (locale === this.sourceLocale) {
        const originalPath = join(this.root, assetId);
        if (await this.io.exists(originalPath)) {
          translations[key] = await this.io.readFile(originalPath);
        }
      } else {
        if (this.options.virtualAssets) {
          const originalPath = join(this.root, assetId);
          if (await this.io.exists(originalPath)) {
            const sourceContent = await this.io.readFile(originalPath);
            const ext = this.getAssetExtension(assetId);
            const body = this.getAssetBody(sourceContent, ext);
            const sourceHashKey = `@zintl/asset-hash:${sha1(body)}`;
            const hive = this.getHive?.();
            let hiveBackup = hive?.[locale]?.[sourceHashKey];
            let isFuzzyMatched = false;

            if (!hiveBackup && hive) {
              const threshold = this.options.similarityThreshold ?? DEFAULT_ASSET_DRIFT_THRESHOLD;
              let bestScore = 0;
              let bestKey = "";

              const sourceKeys = Object.keys(hive[this.sourceLocale] || {}).filter((k) =>
                k.startsWith("@zintl/asset-hash:"),
              );

              const currentBody = this.getAssetBody(sourceContent, ext);

              for (const key of sourceKeys) {
                const oldSourceContent = hive[this.sourceLocale][key];
                if (typeof oldSourceContent === "string") {
                  const oldSourceBody = this.getAssetBody(oldSourceContent, ext);
                  const score = similarity(oldSourceBody, currentBody);
                  if (score >= threshold && score > bestScore) {
                    bestScore = score;
                    bestKey = key;
                  }
                }
              }

              if (bestKey) {
                const fuzzyBackupContent = hive[locale]?.[bestKey];
                if (fuzzyBackupContent) {
                  hiveBackup = fuzzyBackupContent;
                  isFuzzyMatched = true;
                }
              }
            }

            if (hiveBackup) {
              if (isFuzzyMatched) {
                const warning = "Source content has changed slightly. Please review translation.";
                const bodyContent = this.getAssetBody(hiveBackup, ext);
                if (ext.toLowerCase() === ".md" || ext.toLowerCase() === ".mdx") {
                  const { frontmatter } = this.parseFrontmatter(hiveBackup);
                  const { frontmatter: sourceFM } = this.parseFrontmatter(sourceContent);
                  const mergedFM = this.mergeFrontmatter(sourceFM, frontmatter);
                  const fmPrefix = this.stringifyFrontmatter(mergedFM);
                  const cleanBody = bodyContent.replace(/^<!-- \[ZINTL WARNING\] .*? -->\n\n/, "");
                  translations[key] =
                    `${fmPrefix}<!-- [ZINTL WARNING] ${warning} -->\n\n${cleanBody}`;
                } else {
                  const cleanBody = bodyContent.replace(/^\[ZINTL WARNING:.*?\]\n\n/, "");
                  translations[key] = `[ZINTL WARNING: ${warning}]\n\n${cleanBody}`;
                }
              } else {
                translations[key] = hiveBackup;
              }
            } else {
              translations[key] = sourceContent;
            }
          }
        } else {
          const localizedPath = this.getAssetPath(assetId, locale);
          if (await this.io.exists(localizedPath)) {
            translations[key] = await this.io.readFile(localizedPath);
          }
        }
      }
    }
    return translations;
  }
}

/**
 * Localization of static content files — Markdown, text, and whatever else you
 * point it at.
 *
 * Each matched file gets a localized copy per locale: Markdown has its
 * frontmatter values and body translated, text is treated as one body, anything
 * else is copied verbatim. Import the file as usual and you receive the copy
 * for the active locale.
 *
 * Edits are tracked by content, not by path, so rewording a paragraph carries
 * its translation forward instead of resetting the document.
 *
 * Included in the built-in set, configured from the plugin's `assetsTarget` and
 * `virtualAssets` options.
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
    name: "system-static-assets",
    concern: "content",
    priority: 100,
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
    getStateToSave(context: CompilerContext) {
      return getManager(context).getRegisteredAssetsRaw();
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
        if (existsSync(localizedPath)) {
          const varName = `_zintl_asset_${assetCounter++}`;
          imports.push(`import ${varName} from "${toPosixPath(localizedPath)}?zintl-raw";`);
          const assetKey = context.isDev
            ? `@zintl/asset:${assetId}`
            : generateMessageId(`@zintl/asset:${assetId}`);
          catalog[assetKey] = { __zintl_pre_serialized: true, code: varName };
        }
      }
      return { imports, boundaryId: "b_assets", catalog };
    },
  };
}
