/**
 * @module pipeline/observe
 *
 * Phase 1: OBSERVE — Read-Only World
 *
 * "What exists in this program?"
 *
 * This is the parser-dependent boundary. Everything downstream of
 * `FileObservation` is parser-agnostic. Swapping Babel → OXC means
 * reimplementing THIS function — nothing else.
 *
 * Current implementation: uses native observation data from the extractor.
 */

import {
  extract,
  type ExtractionResult,
  type AnchorSite,
  type ExtractionOptions,
} from "@zintljs/extractor";
import { sha1 } from "../utils/hashing.js";
import type {
  ZintlLogger,
  FileObservation,
  ObservedSink,
  ObservedManualT,
  ObservedAnchor,
  ObservedImport,
  ObservedDependency,
  ObservedBoundary,
  SourceLocation,
  AnchorLocale,
} from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observe a source file and produce a pure, immutable fact record.
 *
 * This function is the ONLY parser-dependent code in the pipeline.
 * It wraps the existing Babel-based `extract()` function and converts
 * the result into the formal `FileObservation` type.
 */
export const observe = (
  code: string,
  filePath: string,
  fileId: string,
  logger?: ZintlLogger,
  options?: ExtractionOptions,
): FileObservation => {
  const result = extract(code, filePath, fileId, { logger, ...options });
  return adaptExtractionResult(result, code, fileId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: ExtractionResult → FileObservation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert `ExtractionResult` into a formal `FileObservation`.
 *
 * Uses raw observation data captured directly by visitors for maximum fidelity.
 */
function adaptExtractionResult(
  result: ExtractionResult,
  code: string,
  fileId: string,
): FileObservation {
  // ── Convert raw sinks ───────────────────────────────────────────────────
  const sinks: ObservedSink[] = (result.rawSinks || []).map((raw) => ({
    text: raw.text,
    rawText: raw.text, // RawSink doesn't currently store originalText separately
    sinkType: raw.sinkType,
    location: loc(raw.start, raw.end, { line: raw.line, column: raw.column }),
    boundaryId: raw.boundaryId,
    variables: raw.variables.map((v) => ({
      name: v.name,
      originalName: v.originalName,
      expression: v.expression,
      sourceRange: loc(v.start, v.end, { line: 0, column: 0 }), // Exact offsets, approximate lines
    })),
    note: raw.note,
    passVars: raw.passVars,
    isFragment: raw.isFragment,
    fragmentLocation: raw.isFragment
      ? loc(raw.fragmentStart!, raw.fragmentEnd!, { line: 0, column: 0 })
      : undefined,
    hostNodeLocation:
      raw.hostStart !== undefined
        ? loc(raw.hostStart, raw.hostEnd!, { line: 0, column: 0 })
        : undefined,
    requiresQuoteConversion: raw.requiresQuoteConversion ?? false,
    requiresJsxBraces: raw.requiresJsxBraces ?? false,
    tagMap: raw.tagMap,
  }));

  // ── Convert manual t() calls ────────────────────────────────────────────
  const manualTranslations: ObservedManualT[] = (result.rawManualTranslations || []).map((raw) => ({
    key: raw.key,
    location: loc(raw.start, raw.end, { line: raw.line, column: raw.column }),
    boundaryId: raw.boundaryId,
    paramsSource: raw.paramsSource,
  }));

  // ── Convert anchors ─────────────────────────────────────────────────────
  const anchors: ObservedAnchor[] = result.anchorSites.map((site) => ({
    location: loc(site.start, site.end, { line: 0, column: 0 }),
    scope: site.scope,
    boundaryId: site.boundaryId,
    locale: parseAnchorLocale(site),
    isTopLevel: site.isTopLevel,
    originalName: site.originalName,
    statementLocation: site.statementRange
      ? loc(site.statementRange.start, site.statementRange.end, { line: 0, column: 0 })
      : undefined,
    detectionCode: site.detectionCode,
  }));

  // --- IMPLICIT ANCHOR: Handle import "zintljs" side-effect marker ---
  // If a file has the side-effect import "zintljs", we only promote it to an entry
  // IF it doesn't already have explicit anchors.
  if (result.hasZintlMarker && anchors.length === 0) {
    const end = result.zintlImportGroup?.end ?? 0;
    anchors.push({
      location: loc(end, end, {
        line: 0,
        column: 0,
      }),
      scope: "module",
      boundaryId: fileId,
      locale: { type: "none" },
      isTopLevel: true,
      originalName: "implicit-anchor",
    });
  }

  // ── Convert dependencies ────────────────────────────────────────────────
  const dependencies: ObservedDependency[] = result.dependencies.map((dep) => ({
    id: dep.id,
    dynamic: dep.dynamic,
    bindings: dep.bindings || [],
  }));

  // ── Reconstruct boundary scopes ─────────────────────────────────────────
  const boundaries = reconstructBoundaries(fileId, result);

  // ── Build imports list ──────────────────────────────────────────────────
  const imports = reconstructImports(result);

  return {
    sinks,
    manualTranslations,
    anchors,
    imports,
    dependencies,
    boundaries,
    directives: [], // Directives are already applied to sinks/metadata
    fileId,
    hasZintlMarker: result.hasZintlMarker,
    hasZintlMacro: result.hasZintlMacro,
    contentHash: sha1(code),
    componentFunctions: result.componentFunctions || [],
    isClientComponent: code.includes('"use client"') || code.includes("'use client'"),
    zintlImportLocation: result.zintlImportGroup
      ? loc(result.zintlImportGroup.start, result.zintlImportGroup.end, {
          line: 0,
          column: 0,
        })
      : undefined,
    existingRuntimeImports: result.runtimeImports,
    exportedBoundaries: result.exportedBoundaries || {},
    internalDependencies: (result as any).internalDeps || {},
    htmlProjection: result.htmlProjection,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an `AnchorSite` to an `AnchorLocale`.
 */
function parseAnchorLocale(site: AnchorSite): AnchorLocale {
  if (site.argType === "literal") {
    return { type: "literal", value: site.originalArgs.replace(/['"]/g, "") };
  }
  if (!site.originalArgs) return { type: "none" };
  return { type: "expression", source: site.originalArgs };
}

/**
 * Reconstruct boundary scopes from extraction results.
 */
function reconstructBoundaries(fileId: string, result: ExtractionResult): ObservedBoundary[] {
  const boundaryIds = new Set<string>();
  boundaryIds.add(fileId);

  for (const msg of result.messages) addBoundary(boundaryIds, msg.boundaryId);
  for (const site of result.anchorSites) addBoundary(boundaryIds, site.boundaryId);
  if (result.rawManualTranslations) {
    for (const t of result.rawManualTranslations) addBoundary(boundaryIds, t.boundaryId);
  }
  if (result.rawSinks) {
    for (const s of result.rawSinks) addBoundary(boundaryIds, s.boundaryId);
  }

  const boundaries: ObservedBoundary[] = [];
  for (const bId of boundaryIds) {
    const isNested = bId.includes(":");
    const parentId = isNested ? bId.substring(0, bId.lastIndexOf(":")) : null;
    const hasAnchor = result.anchorSites.some((s) => s.boundaryId === bId);
    const hasMessages = result.messages.some((m) => m.boundaryId === bId);

    boundaries.push({
      id: bId,
      isActive: hasAnchor || result.hasZintlMacro || hasMessages,
      parentId,
      scope: isNested ? "function" : "module",
    });
  }

  return boundaries;
}

/** Add a boundary ID and all its parent IDs to the set. */
function addBoundary(set: Set<string>, id: string) {
  set.add(id);
  // Ensure parent boundaries exist in the set
  if (id.includes(":")) {
    addBoundary(set, id.substring(0, id.lastIndexOf(":")));
  }
}

/**
 * Reconstruct import observations from extraction results.
 */
function reconstructImports(result: ExtractionResult): ObservedImport[] {
  const imports: ObservedImport[] = [];

  // The zintl import (if present)
  if (result.zintlImportGroup) {
    imports.push({
      source: result.zintlImportGroup.source || "zintljs",
      specifiers: result.runtimeImports.map((name) => ({
        local: name,
        imported: name,
        kind: "value" as const,
      })),
      location: loc(result.zintlImportGroup.start, result.zintlImportGroup.end, {
        line: 0,
        column: 0,
      }),
      isDynamic: false,
    });
  }

  // Static and dynamic dependencies become import observations
  for (const dep of result.dependencies) {
    // Polishing: Skip zintl if it was already captured by the explicit group scanner
    // to avoid zero-width duplicates that confuse the consolidation engine.
    if (dep.id === "zintljs" && result.zintlImportGroup) continue;

    imports.push({
      source: dep.id,
      specifiers: [], // Not tracked by current extractor
      location: loc(0, 0, { line: 0, column: 0 }), // Not tracked
      isDynamic: dep.dynamic,
    });
  }

  return imports;
}

/**
 * Create a SourceLocation from offset + line/column.
 */
function loc(
  start: number,
  end: number,
  position: { line: number; column: number },
): SourceLocation {
  return { start, end, line: position.line, column: position.column };
}
