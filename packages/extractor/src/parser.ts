import { parseSync } from "oxc-parser";
import type { Statement } from "@oxc-project/types";
import { ExtractionContext } from "./context.js";
import { ExtractionOptions, ExtractionResult, SfcRule } from "./types.js";
import { createCombinedVisitor } from "./visitors/index.js";
import { walk } from "./walker.js";

import { extractHtml } from "./html.js";
import { resolveTargets, DEFAULT_SFC_RULES } from "./targets.js";

export function extract(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  code = code.replace(/\r\n/g, "\n");

  const targets = options.targets || ["vanilla", "react", "html"];
  const resolved = resolveTargets(targets);

  const sfcRules = [...resolved.sfcRules, ...(options.sfcRules || [])];
  const ext = "." + filePath.split(".").pop();
  if (!sfcRules.some((r) => r.extensions.includes(ext))) {
    const defaultRule = DEFAULT_SFC_RULES.find((r) => r.extensions.includes(ext));
    if (defaultRule) {
      sfcRules.push(defaultRule);
    }
  }
  const sfcRule = sfcRules.find((rule) => rule.extensions.includes(ext));

  // Fast-Path Heuristic: Skip files that are statistically unlikely to contain translatable logic.
  // The regex is derived entirely from the configured targets — no hardcoded framework strings here.
  const isLikelyUI = resolved.fastPathRegex.test(code);

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

  if (sfcRule) {
    return extractSfc(code, filePath, fileBoundaryId, options, sfcRule);
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
  rule: SfcRule,
): ExtractionResult {
  const jsBlocks: {
    id: string;
    content: string;
    start: number;
    startLine: number;
    virtualExt: string;
  }[] = [];

  const ignoreMatches: { start: number; end: number }[] = [];
  const htmlMatches: { start: number; end: number; isActive: boolean }[] = [];

  for (const block of rule.blocks) {
    block.pattern.lastIndex = 0;
    let match;
    while ((match = block.pattern.exec(code)) !== null) {
      let attrs = "";
      let blockContent = "";

      if (match.length >= 3) {
        attrs = match[1] || "";
        blockContent = match[2] || "";
      } else if (match.length === 2) {
        blockContent = match[1] || "";
      } else {
        blockContent = match[0] || "";
      }

      const matchStart = code.indexOf(blockContent, match.index);
      const matchEnd = matchStart + blockContent.length;

      if (block.action === "javascript") {
        const codeBefore = code.substring(0, matchStart);
        const startLine = (codeBefore.match(/\n/g) || []).length;
        const virtualExt = block.resolveVirtualExtension
          ? block.resolveVirtualExtension(attrs)
          : ".ts";

        jsBlocks.push({
          id: block.id,
          content: blockContent,
          start: matchStart,
          startLine,
          virtualExt,
        });
        ignoreMatches.push({ start: match.index, end: match.index + match[0].length });
      } else if (block.action === "ignore") {
        ignoreMatches.push({ start: match.index, end: match.index + match[0].length });
      } else if (block.action === "html") {
        htmlMatches.push({
          start: matchStart,
          end: matchEnd,
          isActive: block.isActiveContent || false,
        });
      }
    }
  }

  // 1. Process JS blocks
  const jsResults: ExtractionResult[] = [];
  for (const block of jsBlocks) {
    if (!block.content.trim()) continue;
    const res = extract(block.content, filePath + block.virtualExt, fileBoundaryId, options);
    // Align offsets relative to original document
    if (res.messages) {
      for (const msg of res.messages) {
        msg.location.line += block.startLine;
      }
    }
    if (res.transforms) {
      for (const t of res.transforms) {
        t.start += block.start;
        t.end += block.start;
      }
    }
    if (res.rawSinks) {
      for (const s of res.rawSinks) {
        s.start += block.start;
        s.end += block.start;
        s.line += block.startLine;
        if (s.hostStart !== undefined) s.hostStart += block.start;
        if (s.hostEnd !== undefined) s.hostEnd += block.start;
        if (s.fragmentStart !== undefined) s.fragmentStart += block.start;
        if (s.fragmentEnd !== undefined) s.fragmentEnd += block.start;
        if (s.variables) {
          for (const v of s.variables) {
            v.start += block.start;
            v.end += block.start;
          }
        }
      }
    }
    if (res.rawManualTranslations) {
      for (const t of res.rawManualTranslations) {
        t.start += block.start;
        t.end += block.start;
        t.line += block.start;
      }
    }
    if (res.anchorSites) {
      for (const s of res.anchorSites) {
        s.start += block.start;
        s.end += block.start;
        if (s.statementRange) {
          s.statementRange.start += block.start;
          s.statementRange.end += block.start;
        }
      }
    }
    if (res.zintlImportGroup) {
      res.zintlImportGroup.start += block.start;
      res.zintlImportGroup.end += block.start;
    }
    jsResults.push(res);
  }

  // 2. Process HTML template content.
  let templateHtml = code;
  const sortedIgnores = [...ignoreMatches].sort((a, b) => b.start - a.start);
  for (const m of sortedIgnores) {
    const len = m.end - m.start;
    templateHtml =
      templateHtml.substring(0, m.start) + " ".repeat(len) + templateHtml.substring(m.end);
  }

  const activeHtml = htmlMatches.find((m) => m.isActive);

  const templateExt = extractHtml(templateHtml, filePath + ".html", fileBoundaryId, {
    ...options,
    isSfcTemplate: true,
    activeRange: activeHtml ? { start: activeHtml.start, end: activeHtml.end } : undefined,
  });

  // Combine results
  const messages = [...jsResults.flatMap((r) => r.messages), ...(templateExt?.messages || [])];
  const transforms = [
    ...jsResults.flatMap((r) => r.transforms),
    ...(templateExt?.transforms || []),
  ];
  const dependencies = [
    ...jsResults.flatMap((r) => r.dependencies),
    ...(templateExt?.dependencies || []),
  ];
  const rawSinks = [...jsResults.flatMap((r) => r.rawSinks), ...(templateExt?.rawSinks || [])];
  const rawManualTranslations = [
    ...jsResults.flatMap((r) => r.rawManualTranslations),
    ...(templateExt?.rawManualTranslations || []),
  ];

  const usedKeys = new Set<string>([
    ...jsResults.flatMap((r) => Array.from(r.usedKeys)),
    ...(templateExt?.usedKeys || []),
  ]);

  const boundaryHashes = {};
  for (const r of jsResults) {
    Object.assign(boundaryHashes, r.boundaryHashes);
  }
  if (templateExt) {
    Object.assign(boundaryHashes, templateExt.boundaryHashes);
  }

  const exportedBoundaries = {};
  for (const r of jsResults) {
    Object.assign(exportedBoundaries, r.exportedBoundaries);
  }
  if (templateExt) {
    Object.assign(exportedBoundaries, templateExt.exportedBoundaries);
  }

  const internalDeps: Record<string, string[]> = {};
  const allDeps = [...jsResults.map((r) => r.internalDeps), templateExt?.internalDeps || {}];
  for (const deps of allDeps) {
    for (const [k, v] of Object.entries(deps)) {
      internalDeps[k] = [...(internalDeps[k] || []), ...v];
    }
  }

  return {
    messages,
    code,
    transforms,
    needsLoader: jsResults.some((r) => r.needsLoader) || (templateExt?.needsLoader ?? false),
    hasZintlMacro: jsResults.some((r) => r.hasZintlMacro) || (templateExt?.hasZintlMacro ?? false),
    hasZintlMarker:
      jsResults.some((r) => r.hasZintlMarker) || (templateExt?.hasZintlMarker ?? false),
    anchorSites: [...jsResults.flatMap((r) => r.anchorSites), ...(templateExt?.anchorSites || [])],
    mode:
      jsResults.some((r) => r.mode === "entry") || templateExt?.mode === "entry"
        ? "entry"
        : "boundary",
    runtimeImports: [
      ...jsResults.flatMap((r) => r.runtimeImports),
      ...(templateExt?.runtimeImports || []),
    ],
    dependencies,
    usedKeys,
    boundaryHashes,
    zintlImportGroup:
      jsResults.find((r) => r.zintlImportGroup)?.zintlImportGroup || templateExt?.zintlImportGroup,
    exportedBoundaries,
    internalDeps,
    rawSinks,
    rawManualTranslations,
    htmlProjection: templateExt?.htmlProjection,
  };
}
