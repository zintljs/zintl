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

/**
 * @deprecated Use ZintlAdapter from the adapter system instead.
 * This legacy type is kept for backward compatibility and will be removed in the next release.
 */
export interface TargetAdapter {
  name: string;
  match: (filePath: string) => boolean;
  jsx?: boolean;
  sfc?: boolean;
  wrapHtmlText?: (replacement: string, hasTags: boolean, hasVars: boolean) => string;
  wrapHtmlAttribute?: (attrName: string, replacement: string, hasVars: boolean) => string;
  wrapSfcScript?: (code: string) => string;
}

// Re-export the canonical adapter types from the adapter module
export type { ZintlAdapter, ResolvedCapabilities, MergedAdapterHooks } from "../adapter/index.js";

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
   * Adapter list. Accepts preset name strings ("react", "vue", "vite", etc.)
   * or ZintlAdapter objects for custom behavior.
   * @example adapters: ["react", "vite", "client-spa"]
   */
  adapters?: (string | import("../adapter/index.js").ZintlAdapter)[];

  // ── Legacy options (deprecated — migrate to adapters) ───────────────────
  // These are auto-wrapped into a "legacy-options" custom adapter on construction
  // and a deprecation warning is emitted in dev mode.

  /** @deprecated Move ssrWrapCode into a ZintlAdapter with an ssr.wrapCode hook */
  ssrWrapCode?: (params: {
    code: string;
    fileId: string;
    isEntry: boolean;
    locales: string[];
    sourceLocale: string;
  }) => string | undefined;
  /** @deprecated Move ssrEntryTargets into a ZintlAdapter with an ssr.entryTargets array */
  ssrEntryTargets?: (string | RegExp | ((id: string) => boolean))[];
  /** @deprecated Move ssrWrapExports into a ZintlAdapter with an ssr.wrapExports array */
  ssrWrapExports?: string[];
  /** @deprecated Move ssrWrapDefault into a ZintlAdapter with an ssr.wrapDefault field */
  ssrWrapDefault?: boolean | "fetch";
  /** @deprecated Move hmrInjectionCode into a ZintlAdapter with a bundler.hmrInjectionCode hook */
  hmrInjectionCode?: (fileId: string, hmrToken: number) => string;
  /** @deprecated Move resolveVirtualPath into a ZintlAdapter with a bundler.resolveVirtualPath hook */
  resolveVirtualPath?: (id: string) => string;
  /** @deprecated Move dynamicImportTemplate into a ZintlAdapter with a bundler.dynamicImportTemplate hook */
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
