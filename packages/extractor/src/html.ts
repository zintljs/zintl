import { ExtractionOptions, ExtractionResult, HtmlProjectionPayload } from "./types.js";
import { ExtractionContext } from "./context.js";

/**
 * Extracts translatable configuration from HTML files.
 * Supports: <title>, <meta name="description">, and module <script src="...">.
 */
export function extractHtml(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  code = code.replace(/\r\n/g, "\n");
  const ctx = new ExtractionContext(code, filePath, fileBoundaryId, options);
  ctx.logger.debug(`Extracting HTML configurations from ${filePath}`);

  const projection: HtmlProjectionPayload = {
    scripts: [],
  };

  // 0. Strip comments to avoid extracting commented out configurations
  const cleanCode = code.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

  // 1. Extract <html dir="...">
  const htmlDirMatch = cleanCode.match(/<html[^>]*dir=["'](ltr|rtl|auto)["']/i);
  if (htmlDirMatch) {
    projection.dir = htmlDirMatch[1].toLowerCase();
  }

  // 2. Extract <title>
  const titleMatch = cleanCode.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    projection.title = titleMatch[1].trim();
  }

  // 2. Extract <meta name="description">
  const descMatch =
    cleanCode.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    cleanCode.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (descMatch) {
    projection.description = descMatch[1].trim();
  }

  // 3. Extract scripts: <script src="...">
  const scriptRegex = /<script[^>]*src=["']([^"']*)["']/gi;
  let match;
  while ((match = scriptRegex.exec(cleanCode)) !== null) {
    projection.scripts.push(match[1]);
  }

  return {
    messages: [],
    code,
    transforms: [],
    needsLoader: false,
    hasZintlMacro: false,
    hasZintlMarker: false,
    anchorSites: [],
    mode: "boundary",
    runtimeImports: [],
    dependencies: projection.scripts.map((s) => ({ id: s, dynamic: false })),
    usedKeys: new Set(),
    boundaryHashes: {},
    exportedBoundaries: {},
    internalDeps: {},
    rawSinks: [],
    rawManualTranslations: [],
    htmlProjection: projection,
  };
}
