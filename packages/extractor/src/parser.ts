import { parseSync } from "oxc-parser";
import type { Statement } from "@oxc-project/types";
import { ExtractionContext } from "./context.js";
import { ExtractionOptions, ExtractionResult } from "./types.js";
import { createCombinedVisitor } from "./visitors/index.js";
import { walk } from "./walker.js";

import { extractHtml } from "./html.js";
import { ZINTL_MACRO } from "./constants.ts";
import { resolveTargets } from "./targets.js";

export function extract(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  code = code.replace(/\r\n/g, "\n");

  const targets = options.targets || ["vanilla", "react", "html"];
  const resolved = resolveTargets(targets);

  let hints = resolved.uniqueHints;
  if (options.uiObjectFields || options.uiSinkProperties || options.uiAttributes) {
    const hintsSet = new Set(resolved.uniqueHints);
    if (options.uiObjectFields) {
      for (const f of options.uiObjectFields) hintsSet.add(f);
    }
    if (options.uiSinkProperties) {
      for (const p of options.uiSinkProperties) hintsSet.add(p);
    }
    if (options.uiAttributes) {
      for (const a of options.uiAttributes) hintsSet.add(a);
    }
    hints = Array.from(hintsSet);
  }

  // Fast-Path Heuristic: Skip files that are statistically unlikely to contain translatable logic.
  const isLikelyUI =
    code.includes(ZINTL_MACRO) ||
    code.includes("t(") ||
    code.includes("<") ||
    hints.some((s) => code.includes(s));

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

  if (filePath.endsWith(".vue") || filePath.endsWith(".svelte")) {
    return extractSfc(code, filePath, fileBoundaryId, options);
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
        sourceVal === "zintl" ||
        sourceVal === "zintl/internal" ||
        sourceVal === "zintl/macro" ||
        sourceVal === "virtual:zintl/runtime/internal" ||
        sourceVal === ctx.runtimePackage;
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

function extractSfc(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions,
): ExtractionResult {
  let script = "";
  let scriptLang = "ts";
  let scriptStart = 0;
  let scriptStartLine = 0;

  const isVue = filePath.endsWith(".vue");
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  const scriptMatch = scriptRegex.exec(code);
  if (scriptMatch) {
    script = scriptMatch[1];
    scriptStart = code.indexOf(scriptMatch[1], scriptMatch.index);
    const codeBeforeScript = code.substring(0, scriptStart);
    scriptStartLine = (codeBeforeScript.match(/\n/g) || []).length;

    const openTag = scriptMatch[0];
    const langMatch = /lang=["']([^"']+)["']/i.exec(openTag);
    if (langMatch) {
      scriptLang = langMatch[1];
    }
  }

  const scriptExt = script.trim()
    ? extract(
        script,
        filePath + (scriptLang === "ts" || scriptLang === "tsx" ? ".tsx" : ".jsx"),
        fileBoundaryId,
        options,
      )
    : null;

  if (scriptExt && scriptStart > 0) {
    if (scriptExt.messages) {
      for (const msg of scriptExt.messages) {
        msg.location.line += scriptStartLine;
      }
    }
    if (scriptExt.transforms) {
      for (const t of scriptExt.transforms) {
        t.start += scriptStart;
        t.end += scriptStart;
      }
    }
    if (scriptExt.rawSinks) {
      for (const s of scriptExt.rawSinks) {
        s.start += scriptStart;
        s.end += scriptStart;
        s.line += scriptStartLine;
        if (s.hostStart !== undefined) s.hostStart += scriptStart;
        if (s.hostEnd !== undefined) s.hostEnd += scriptStart;
        if (s.fragmentStart !== undefined) s.fragmentStart += scriptStart;
        if (s.fragmentEnd !== undefined) s.fragmentEnd += scriptStart;
        if (s.variables) {
          for (const v of s.variables) {
            v.start += scriptStart;
            v.end += scriptStart;
          }
        }
      }
    }
    if (scriptExt.rawManualTranslations) {
      for (const t of scriptExt.rawManualTranslations) {
        t.start += scriptStart;
        t.end += scriptStart;
        t.line += scriptStart;
      }
    }
    if (scriptExt.anchorSites) {
      for (const s of scriptExt.anchorSites) {
        s.start += scriptStart;
        s.end += scriptStart;
        if (s.statementRange) {
          s.statementRange.start += scriptStart;
          s.statementRange.end += scriptStart;
        }
      }
    }
    if (scriptExt.zintlImportGroup) {
      scriptExt.zintlImportGroup.start += scriptStart;
      scriptExt.zintlImportGroup.end += scriptStart;
    }
  }

  let templateHtml = code;
  templateHtml = templateHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match) =>
    " ".repeat(match.length),
  );
  templateHtml = templateHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (match) =>
    " ".repeat(match.length),
  );

  const hasTemplate = /<template\b/i.test(code) || (!isVue && code.trim().length > 0);
  const templateExt = hasTemplate
    ? extractHtml(templateHtml, filePath + ".html", fileBoundaryId, options)
    : null;

  const messages = [...(scriptExt?.messages || []), ...(templateExt?.messages || [])];
  const transforms = [...(scriptExt?.transforms || []), ...(templateExt?.transforms || [])];
  const dependencies = [...(scriptExt?.dependencies || []), ...(templateExt?.dependencies || [])];
  const rawSinks = [...(scriptExt?.rawSinks || []), ...(templateExt?.rawSinks || [])];
  const rawManualTranslations = [
    ...(scriptExt?.rawManualTranslations || []),
    ...(templateExt?.rawManualTranslations || []),
  ];

  const usedKeys = new Set<string>([
    ...(scriptExt?.usedKeys || []),
    ...(templateExt?.usedKeys || []),
  ]);

  const boundaryHashes = {
    ...scriptExt?.boundaryHashes,
    ...templateExt?.boundaryHashes,
  };

  const exportedBoundaries = {
    ...scriptExt?.exportedBoundaries,
    ...templateExt?.exportedBoundaries,
  };

  const internalDeps: Record<string, string[]> = {};
  if (scriptExt?.internalDeps) {
    for (const [k, v] of Object.entries(scriptExt.internalDeps)) {
      internalDeps[k] = [...(internalDeps[k] || []), ...v];
    }
  }
  if (templateExt?.internalDeps) {
    for (const [k, v] of Object.entries(templateExt.internalDeps)) {
      internalDeps[k] = [...(internalDeps[k] || []), ...v];
    }
  }

  return {
    messages,
    code,
    transforms,
    needsLoader: (scriptExt?.needsLoader || templateExt?.needsLoader) ?? false,
    hasZintlMacro: (scriptExt?.hasZintlMacro || templateExt?.hasZintlMacro) ?? false,
    hasZintlMarker: (scriptExt?.hasZintlMarker || templateExt?.hasZintlMarker) ?? false,
    anchorSites: [...(scriptExt?.anchorSites || []), ...(templateExt?.anchorSites || [])],
    mode: scriptExt?.mode === "entry" || templateExt?.mode === "entry" ? "entry" : "boundary",
    runtimeImports: [...(scriptExt?.runtimeImports || []), ...(templateExt?.runtimeImports || [])],
    dependencies,
    usedKeys,
    boundaryHashes,
    zintlImportGroup: scriptExt?.zintlImportGroup || templateExt?.zintlImportGroup,
    exportedBoundaries,
    internalDeps,
    rawSinks,
    rawManualTranslations,
    htmlProjection: templateExt?.htmlProjection,
  };
}
