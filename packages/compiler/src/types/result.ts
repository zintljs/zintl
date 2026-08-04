import type { SourceMap } from "magic-string";
import type { SourceLocation } from "./ast.js";
import type { Diagnostic } from "./plan.js";

/**
 * The result of applying a resolved plan to source code.
 */
export interface TransformResult {
  code: string;
  map: SourceMap;
  diagnostics: Diagnostic[];
}

/**
 * Result of post-condition validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export type ValidationError =
  | MissingImportError
  | OrphanManagerError
  | OverlappingRewriteError
  | BrokenTemplateError
  | UnresolvedBoundaryError
  | StrayMarkerError;

interface MissingImportError {
  type: "missing_import";
  name: string;
}

interface OrphanManagerError {
  type: "orphan_manager";
  managerId: string;
}

interface OverlappingRewriteError {
  type: "overlapping_rewrite";
  range: SourceLocation;
}

interface BrokenTemplateError {
  type: "broken_template";
  location: SourceLocation;
}

interface UnresolvedBoundaryError {
  type: "unresolved_boundary";
  boundaryId: string;
}

interface StrayMarkerError {
  type: "stray_marker";
  marker: string;
  location?: SourceLocation;
}
