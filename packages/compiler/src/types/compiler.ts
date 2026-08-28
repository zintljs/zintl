import type { LogLevel, ZintlLogger } from "@zintljs/extractor";
import type { CompilerCapabilities } from "./capabilities.js";
export type { LogLevel, ZintlLogger };

/**
 * How a localized copy of a static asset is produced from its source file.
 *
 * - `"frontmatter"` — parse YAML frontmatter and translate values plus body text.
 *   The default for `.md` and `.mdx`.
 * - `"text-passthrough"` — treat the whole file as one translatable body.
 *   The default for `.txt`.
 * - `"binary-passthrough"` — copy the bytes unchanged. The default for anything else.
 * - A function — full control. Receives the source bytes, the previously emitted
 *   bytes for this locale (`null` on first run) and the target locale, and
 *   returns the bytes to emit.
 */
/**
 * A group of static content files to localize.
 *
 * Passed to the plugin as `assetsTarget`, where a bare extension string like
 * `"md"` is shorthand for `{ targetPattern: "**\/*.md" }`.
 *
 * Purely positional: which files are targeted, and where their artifacts go.
 * The `strategy` this used to carry described how to build a localized copy
 * *from its source*, and nothing is built from a source any more — every
 * targeted asset is scaffolded empty and authored (proposal 035 §3).
 */
export interface AssetTargetConfig {
  /** Glob matching the source files to localize, relative to the project root. */
  targetPattern: string;
  /**
   * Where localized copies are written, relative to `outputDir`.
   *
   * Tokens: `[locale]`, `[locales]`, `[dir]`, `[name]`, `[ext]`.
   *
   * @default `<path>.<locale><ext>` under `outputDir`
   */
  outputPattern?: string;
}

/**
 * What `ZintlCompiler` is constructed with.
 *
 * Not the user-facing surface: users configure the Vite plugin, whose `Options`
 * documents each of these fields with its effective default and adds the plugin
 * -only ones (`facets`, `assetsTarget`, `virtualAssets`). Everything here except
 * `capabilities` is passed straight through from there.
 */
export interface CompilerOptions {
  sourceLocale?: string;
  locales?: string[];
  /** @see Options.pendingLocales — maintained but not shipped (031). */
  pendingLocales?: string[];
  outputDir?: string;
  catalogFormat?: string | ((ctx: CatalogFormatContext) => string);
  similarityThreshold?: number;
  logLevel?: LogLevel;
  metadataDir?: string;
  debug?: boolean | string;
  prune?: boolean;
  verifyIntegrity?: boolean;
  pseudoLocalize?: boolean;
  multiplex?: boolean;
  /**
   * Entry scripts an HTML document loads, where the markup does not say so.
   *
   * Keyed by normalized HTML file id (`"index.html"`), valued with source ids
   * relative to the root (`["src/main.ts"]`).
   *
   * Zintl normally reads this out of `<script src>` tags, which is how a
   * document reaches a trust anchor and becomes a boundary. That is a
   * plain-HTML convention rather than a universal one: an Rsbuild template
   * carries no script tag, because the entry is injected at build time from
   * `source.entry`, so the association lives in the build config where only the
   * host can see it (ledger L-021).
   *
   * Unioned with whatever the markup declares, never replacing it. Empty or
   * absent means "the markup is the whole story", which is true of every
   * Vite project.
   */
  htmlEntries?: Record<string, string[]>;
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

/**
 * The pieces of a boundary handed to a `catalogFormat` function, one per
 * supported token.
 */
export interface CatalogFormatContext {
  /** Target locale, e.g. `"ar"`. */
  locale: string;
  /** Full boundary id. When substituted into a token string, `:` and `/` become `_`. */
  bId: string;
  /** Stable short hash of the boundary. */
  hash: string;
  /** The boundary's source path, e.g. `"src/pages/Home.ts"`. */
  path: string;
  /** Directory of `path`, e.g. `"src/pages"` (`"."` for the project root). */
  dir: string;
  /** Filename of `path`, extension included, e.g. `"Home.ts"`. */
  name: string;
  /** Enclosing function, for anchors nested inside one; empty for module-level anchors. */
  func: string;
}

export type CatalogCache = Record<string, Record<string, Record<string, string>>>;
