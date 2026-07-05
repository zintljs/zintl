import type { LogLevel, ZintlLogger } from "@zintl/extractor";
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

export interface ZintlOptions {
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
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  extensions?: string[];
  /**
   * Facet / Contribution list. Accepts preset name strings ("react", "vue", "vite", etc.),
   * custom contribution objects, preset objects, or nested arrays of them.
   * @example facets: ["react", "vite", "client-spa"]
   */
  facets?: (
    | string
    | import("../facet/index.js").ZintlFacet
    | (string | import("../facet/index.js").ZintlFacet)[]
  )[];
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
