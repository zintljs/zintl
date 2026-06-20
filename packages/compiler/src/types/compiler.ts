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

export interface TargetAdapter {
  name: string;
  match: (filePath: string) => boolean;
  jsx?: boolean;
  sfc?: boolean;
  wrapHtmlText?: (replacement: string, hasTags: boolean, hasVars: boolean) => string;
  wrapHtmlAttribute?: (attrName: string, replacement: string, hasVars: boolean) => string;
  wrapSfcScript?: (code: string) => string;
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
  adapters?: TargetAdapter[];
  hmrInjectionCode?: (fileId: string, hmrToken: number) => string;
  ssrWrapCode?: (params: {
    code: string;
    fileId: string;
    isEntry: boolean;
    locales: string[];
    sourceLocale: string;
  }) => string | undefined;
  ssrEntryTargets?: (string | RegExp | ((id: string) => boolean))[];
  ssrWrapExports?: string[];
  ssrWrapDefault?: boolean | "fetch";
  resolveVirtualPath?: (id: string) => string;
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
