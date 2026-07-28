import type { LogLevel, ZintlLogger } from "@zintl/extractor";
import type { ZintlFacet } from "../facet/index.js";
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
   * Resolved compiler facets list.
   */
  facets?: CompilerFacetInput[];
}

type CompilerFacetInput = ZintlFacet | CompilerFacetInput[];

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
