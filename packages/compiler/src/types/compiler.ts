import type { LogLevel, ZintlLogger } from "@zintl/extractor";
import type { CompilerCapabilities } from "./capabilities.js";
export type { LogLevel, ZintlLogger };

export type AssetMergeStrategy =
  | "frontmatter"
  | "text-passthrough"
  | "binary-passthrough"
  | ((source: Buffer, existing: Buffer | null, locale: string) => Buffer);

export interface AssetTargetConfig {
  targetPattern: string;
  strategy?: AssetMergeStrategy;
  outputPattern?: string;
}

export interface CompilerOptions {
  sourceLocale?: string;
  locales?: string[];
  outputDir?: string;
  catalogFormat?: string | ((ctx: CatalogFormatContext) => string);
  similarityThreshold?: number;
  logLevel?: LogLevel;
  metadataDir?: string;
  debug?: boolean | string;
  prune?: boolean;
  verifyIntegrity?: boolean;
  multiplex?: boolean;
  /**
   * The compiler's entire behavioral surface, pre-resolved by the host plugin.
   *
   * The compiler does not resolve facets and does not know which facets exist —
   * it only knows the capabilities it has been given. Selecting facets, applying
   * defaults, merging them and detecting conflicts all belong to the host plugin
   * (see `zintl`'s `facets/resolve.ts`).
   */
  capabilities: CompilerCapabilities;
}

interface CatalogFormatContext {
  locale: string;
  bId: string;
  hash: string;
  path: string;
  dir: string;
  name: string;
  func: string;
}

export type CatalogCache = Record<string, Record<string, Record<string, string>>>;
