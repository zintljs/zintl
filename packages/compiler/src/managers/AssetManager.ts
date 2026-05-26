import { join, isAbsolute, relative } from "node:path";
import { IOManager } from "./IOManager.js";
import type { ZintlLogger, ZintlOptions, AssetMergeStrategy } from "../types/index.js";
import type { CatalogManager } from "./CatalogManager.js";

/**
 * Manages translation for static assets like Markdown (.md) and Text (.txt) files.
 */
export class AssetManager {
  private registeredAssets = new Set<string>();

  constructor(
    private readonly io: IOManager,
    private readonly root: string,
    private readonly sourceLocale: string,
    private readonly locales: string[],
    private readonly logger: ZintlLogger,
    private readonly catalog: CatalogManager,
    private readonly options: ZintlOptions = {},
    private readonly getDependencyGraph?: () => Record<string, any[]>,
  ) {}

  private isAssetUsed(assetId: string): boolean {
    if (!this.getDependencyGraph) return true;
    const depGraph = this.getDependencyGraph();
    if (!depGraph || Object.keys(depGraph).length === 0) return true;

    const normAssetId = assetId.replace(/\\/g, "/");

    for (const deps of Object.values(depGraph)) {
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          if (dep && typeof dep.id === "string") {
            const cleanDepId = dep.id.split("?")[0].replace(/\\/g, "/");
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
   * Resolves the customized asset pattern configuration for a given path.
   */
  private resolveAssetConfig(filePath: string): {
    targetPattern: string;
    strategy: AssetMergeStrategy;
    outputPattern?: string;
  } | null {
    const absolutePath = isAbsolute(filePath) ? filePath : join(this.root, filePath);
    const relativePath = relative(this.root, absolutePath).replace(/\\/g, "/");

    const assetsTarget = this.options.assetsTarget || ["md", "txt", "png", "jpg", "jpeg", "webp"];

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

  /**
   * Registers a discovered static asset.
   */
  public async registerAsset(filePath: string) {
    const absoluteOutputDir = isAbsolute(this.catalog.outputDir)
      ? this.catalog.outputDir
      : join(this.root, this.catalog.outputDir);

    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedOutputDir = absoluteOutputDir.replace(/\\/g, "/");
    if (
      normalizedPath === normalizedOutputDir ||
      normalizedPath.startsWith(normalizedOutputDir + "/")
    ) {
      return;
    }

    const normalizedId = this.io.getNormalizedId(filePath);
    this.registeredAssets.add(normalizedId);

    // Synchronize localized target files immediately in dev mode and build
    await this.syncSingleAsset(normalizedId);
  }

  /**
   * Synchronizes a single asset's localized targets to disk.
   */
  public async syncSingleAsset(assetId: string) {
    const config = this.resolveAssetConfig(assetId);
    if (!config) return;

    const originalPath = join(this.root, assetId);
    if (!(await this.io.exists(originalPath))) return;

    for (const locale of this.locales) {
      if (locale === this.sourceLocale) continue;

      const destPath = this.getAssetPath(assetId, locale);

      if (config.strategy === "binary-passthrough") {
        if (!(await this.io.exists(destPath))) {
          const buffer = await this.io.readBuffer(originalPath);
          await this.io.safeWriteBuffer(destPath, buffer);
        }
      } else {
        const sourceContent = await this.io.readFile(originalPath);
        let existingContent = "";
        if (await this.io.exists(destPath)) {
          existingContent = await this.io.readFile(destPath);
        }

        let merged: string;
        if (typeof config.strategy === "function") {
          const srcBuf = Buffer.from(sourceContent, "utf-8");
          const extBuf = existingContent ? Buffer.from(existingContent, "utf-8") : null;
          const resBuf = config.strategy(srcBuf, extBuf, locale);
          merged = resBuf.toString("utf-8");
        } else if (config.strategy === "text-passthrough") {
          merged = existingContent.trim() ? existingContent : sourceContent;
        } else {
          // frontmatter merge
          merged = this.mergeContent(
            sourceContent,
            existingContent,
            this.getAssetExtension(assetId),
            locale,
          );
        }

        await this.io.safeWriteFile(destPath, merged);
      }
    }
  }

  /**
   * Returns all registered assets.
   */
  public getRegisteredAssets(): string[] {
    return Array.from(this.registeredAssets).filter((assetId) => this.isAssetUsed(assetId));
  }

  /**
   * Checks if a file path is a supported static asset.
   */
  public isSupportedAsset(filePath: string): boolean {
    return this.resolveAssetConfig(filePath) !== null;
  }

  /**
   * Returns the file extension for a given asset ID.
   */
  public getAssetExtension(id: string): string {
    const idx = id.lastIndexOf(".");
    return idx !== -1 ? id.substring(idx) : ".txt";
  }

  /**
   * Returns only the translated content, preserving frontmatter.
   */
  public getTranslationOnly(content: string, _ext: string): string {
    return content;
  }

  /**
   * Resolves the customized physical file path for the localized static content file.
   */
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

    const hasCatalogFormat = !!(this.catalog as any).catalogFormat;
    const isMultilingual =
      hasCatalogFormat && !(this.catalog as any).catalogFormat.includes("[locale]");

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

  /**
   * Parses standard YAML-like frontmatter.
   */
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

  /**
   * Stringifies frontmatter dictionary back to YAML block.
   */
  private stringifyFrontmatter(frontmatter: Record<string, string>): string {
    if (Object.keys(frontmatter).length === 0) return "";
    let yaml = "---\n";
    for (const [k, v] of Object.entries(frontmatter)) {
      yaml += `${k}: ${v}\n`;
    }
    yaml += "---\n";
    return yaml;
  }

  /**
   * Merges original/source and target frontmatter properties.
   */
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

  /**
   * Merges content by preserving existing translation while keeping frontmatter keys in sync.
   */
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

  /**
   * Synchronizes and emits localized static content files to disk.
   */
  public async syncAssets(_locales: string[]) {
    const assets = this.getRegisteredAssets();
    this.logger.debug(`Syncing static assets (${assets.length} files)`);
    for (const assetId of assets) {
      await this.syncSingleAsset(assetId);
    }
  }

  /**
   * Returns a list of all active localized asset file paths for the given locales.
   */
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
      this.registeredAssets.delete(assetId);
    }

    return paths;
  }

  /**
   * Checks if a file path is a localized version of a registered asset.
   */
  public async isLocalizedAsset(filePath: string): Promise<boolean> {
    const normalized = this.io.getNormalizedId(filePath);
    const paths = await this.getActiveAssetPaths(this.locales);

    for (const p of paths) {
      if (this.io.getNormalizedId(p) === normalized) return true;
    }
    return false;
  }

  /**
   * Returns all asset translations for a given locale.
   */
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
        const localizedPath = this.getAssetPath(assetId, locale);
        if (await this.io.exists(localizedPath)) {
          translations[key] = await this.io.readFile(localizedPath);
        }
      }
    }
    return translations;
  }
}
