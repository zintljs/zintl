import type { LogLevel, ZintlLogger, TargetDescriptor } from "@zintl/extractor";
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
  targets?: TargetDescriptor[];
  assetsTarget?: (string | AssetTargetConfig)[];
  vitePlugins?: readonly any[];
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

  // ── Legacy options (deprecated — migrate to facets) ───────────────────
  // These are auto-wrapped into a "legacy-options" custom facet on construction
  // and a deprecation warning is emitted in dev mode.

  /** @deprecated Move ssrWrapCode into a ZintlFacet with an ssr.wrapCode hook */
  ssrWrapCode?: (params: {
    code: string;
    fileId: string;
    isEntry: boolean;
    locales: string[];
    sourceLocale: string;
  }) => string | undefined;
  /** @deprecated Move ssrEntryTargets into a ZintlFacet with an ssr.entryTargets array */
  ssrEntryTargets?: (string | RegExp | ((id: string) => boolean))[];
  /** @deprecated Move ssrWrapExports into a ZintlFacet with an ssr.wrapExports array */
  ssrWrapExports?: string[];
  /** @deprecated Move ssrWrapDefault into a ZintlFacet with an ssr.wrapDefault field */
  ssrWrapDefault?: boolean | "fetch";
  /** @deprecated Move hmrInjectionCode into a ZintlFacet with a bundler.hmrInjectionCode hook */
  hmrInjectionCode?: (fileId: string, hmrToken: number) => string;
  /** @deprecated Move resolveVirtualPath into a ZintlFacet with a bundler.resolveVirtualPath hook */
  resolveVirtualPath?: (id: string) => string;
  /** @deprecated Move dynamicImportTemplate into a ZintlFacet with a bundler.dynamicImportTemplate hook */
  dynamicImportTemplate?: (path: string, isDev: boolean) => string;
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
