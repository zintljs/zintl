import { parseSync } from "oxc-parser";
import type { Statement } from "@oxc-project/types";
import { ExtractionContext } from "./context.js";
import { ExtractionOptions, ExtractionResult } from "./types.js";
import { createCombinedVisitor } from "./visitors/index.js";
import { walk } from "./walker.js";

import { extractHtml } from "./html.js";
import {
  DEFAULT_UI_ATTRIBUTES,
  DEFAULT_UI_OBJECT_FIELDS,
  DEFAULT_UI_SINK_PROPERTIES,
  ZINTL_MACRO,
} from "./constants.ts";

export function extract(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  code = code.replace(/\r\n/g, "\n");
  const activeSinks = Array.from(options.uiObjectFields || DEFAULT_UI_OBJECT_FIELDS)
    .concat(DEFAULT_UI_SINK_PROPERTIES)
    .concat(Array.from(options.uiAttributes || DEFAULT_UI_ATTRIBUTES)) as string[];

  // Fast-Path Heuristic: Skip files that are statistically unlikely to contain translatable logic.
  // We check for:
  // 1. Explicit zintl() calls or t() calls.
  // 2. JSX syntax (<tag).
  // 3. UI Sink properties (innerHTML, ariaLabel, etc.) followed by an assignment or object property pattern.
  const isLikelyUI =
    code.includes(ZINTL_MACRO) ||
    code.includes("t(") ||
    code.includes("<") ||
    activeSinks.some((s) => code.includes(s));

  // we do not want to skip modules that may has imported another modules that use zintl() or has ui sinks
  const isLikelyBridge = code.includes("import");
  if (!isLikelyUI && !isLikelyBridge) {
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
      dependencies: [],
      usedKeys: new Set(),
      boundaryHashes: {},
      exportedBoundaries: {},
      internalDeps: {},
      rawSinks: [],
      rawManualTranslations: [],
    };
  }

  if (filePath.endsWith(".html")) {
    return extractHtml(code, filePath, fileBoundaryId, options);
  }

  // const activeSinks = Array.from(options.uiObjectFields || DEFAULT_UI_OBJECT_FIELDS)
  //   .concat(DEFAULT_UI_SINK_PROPERTIES)
  //   .concat(Array.from(options.uiAttributes || DEFAULT_UI_ATTRIBUTES)) as string[];

  const ctx = new ExtractionContext(code, filePath, fileBoundaryId, options);
  ctx.logger.debug(`Extracting messages from ${filePath}`);

  // Parse with OXC - Force .tsx if we detect JSX patterns to ensure robust extraction in tests
  const virtualPath =
    code.includes("<") && !filePath.endsWith(".tsx") ? filePath + ".tsx" : filePath;

  const result = parseSync(virtualPath, code, {
    sourceType: "module",
  });

  if (result.errors.length > 0) {
    ctx.logger.warn(`OXC Parse Errors in ${filePath}:`, result.errors);
  }

  // Inject trivias into context for comment parsing
  ctx.trivias = result.comments;

  // Side-effect import detection ($M marker) - Done before walk to be absolutely sure
  result.program.body.forEach((stmt: Statement) => {
    if (stmt.type === "ImportDeclaration") {
      const sourceVal = stmt.source?.value ?? "";
      const isZintl =
        sourceVal === "zintl" || sourceVal === "zintl/internal" || sourceVal === ctx.runtimePackage;
      const hasNoSpecifiers = !stmt.specifiers || stmt.specifiers.length === 0;
      if (isZintl) {
        ctx.zintlImportGroup = { start: stmt.start, end: stmt.end, source: sourceVal };
        if (hasNoSpecifiers) {
          ctx.hasZintlMarker = true;
          ctx.mode = "entry";
        }
      }
    }
  });

  const visitor = createCombinedVisitor(ctx);

  // Walk the AST
  walk(result.program, visitor, ctx);

  const res: ExtractionResult = {
    messages: Array.from(ctx.messages.values()),
    code,
    transforms: ctx.transforms,
    needsLoader: ctx.messages.size > 0 || ctx.usedKeys.size > 0,
    hasZintlMacro: ctx.hasZintlMacro,
    hasZintlMarker: ctx.hasZintlMarker,
    anchorSites: ctx.anchorSites,
    mode: ctx.mode,
    runtimeImports: ctx.runtimeImports,
    zintlImportGroup: ctx.zintlImportGroup,
    rawSinks: ctx.rawSinks,
    rawManualTranslations: ctx.rawManualTranslations,
    exportedBoundaries: Object.fromEntries(ctx.exportedBoundaries),
    internalDeps: Object.fromEntries(
      Array.from(ctx.internalDeps.entries()).map(([k, v]) => [k, Array.from(v)]),
    ),
    usedKeys: ctx.usedKeys,
    boundaryHashes: ctx.computeBoundaryHashes(),
    dependencies: Array.from(ctx.dependencyPaths, ([id, dynamic]) => ({
      id,
      dynamic,
      bindings: Array.from(ctx.dependencyBindings.get(id) || []),
    })),
  };

  return res;
}
