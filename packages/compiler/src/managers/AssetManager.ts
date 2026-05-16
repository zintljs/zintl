import { join, isAbsolute } from "node:path";
import { IOManager } from "./IOManager.js";
import type { ZintlLogger } from "../types/index.js";
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
  ) {}

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
    const ext = this.getAssetExtension(assetId);
    const originalPath = join(this.root, assetId);
    if (!(await this.io.exists(originalPath))) return;

    const sourceContent = await this.io.readFile(originalPath);

    for (const locale of this.locales) {
      if (locale === this.sourceLocale) continue;

      const destPath = this.getAssetPath(assetId, locale);
      let existingContent = "";
      if (await this.io.exists(destPath)) {
        existingContent = await this.io.readFile(destPath);
      }

      const merged = this.mergeContent(sourceContent, existingContent, ext, locale);
      await this.io.safeWriteFile(destPath, merged);
    }
  }

  /**
   * Returns all registered assets.
   */
  public getRegisteredAssets(): string[] {
    return Array.from(this.registeredAssets);
  }

  private static readonly SUPPORTED_EXTENSIONS = [".md", ".txt", ".png", ".jpg", ".jpeg", ".webp"];

  /**
   * Checks if a file path is a supported static asset.
   */
  public isSupportedAsset(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return AssetManager.SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  /**
   * Returns the file extension for a given asset ID.
   */
  public getAssetExtension(id: string): string {
    const lower = id.toLowerCase();
    for (const ext of AssetManager.SUPPORTED_EXTENSIONS) {
      if (lower.endsWith(ext)) return ext;
    }
    return ".txt";
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
    const hasCatalogFormat = !!(this.catalog as any).catalogFormat;
    const isMultilingual =
      hasCatalogFormat && !(this.catalog as any).catalogFormat.includes("[locale]");

    if (!hasCatalogFormat || isMultilingual) {
      // If no catalogFormat is defined, or if catalogFormat is multilingual (lacks [locale]),
      // we generate the localized asset at: join(baseDir, id_with_locale_inserted)
      // e.g. id = "src/about.txt", baseDir = "/root/locales" -> "/root/locales/src/about.ar.txt"
      const baseDir = isAbsolute(this.catalog.outputDir)
        ? this.catalog.outputDir
        : join(this.root, this.catalog.outputDir);

      const cleanId = id.endsWith(ext) ? id.substring(0, id.length - ext.length) : id;
      return join(baseDir, `${cleanId}.${locale}${ext}`);
    }

    // Otherwise, we respect the catalogFormat with [locale]
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
  public async syncAssets(locales: string[]) {
    this.logger.debug(`Syncing static assets (${this.registeredAssets.size} files)`);
    for (const assetId of this.registeredAssets) {
      const ext = this.getAssetExtension(assetId);
      const originalPath = join(this.root, assetId);
      if (!(await this.io.exists(originalPath))) continue;

      const sourceContent = await this.io.readFile(originalPath);

      for (const locale of locales) {
        if (locale === this.sourceLocale) continue;

        const destPath = this.getAssetPath(assetId, locale);
        let existingContent = "";
        if (await this.io.exists(destPath)) {
          existingContent = await this.io.readFile(destPath);
        }

        const merged = this.mergeContent(sourceContent, existingContent, ext, locale);
        await this.io.safeWriteFile(destPath, merged);
      }
    }
  }

  /**
   * Returns a list of all active localized asset file paths for the given locales.
   */
  public async getActiveAssetPaths(locales: string[]): Promise<Set<string>> {
    const paths = new Set<string>();
    const toRemove = new Set<string>();

    for (const assetId of this.registeredAssets) {
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

    // Clean up registered assets that no longer exist on disk
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

    // Check by normalized ID to be safe
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
    for (const assetId of this.registeredAssets) {
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
