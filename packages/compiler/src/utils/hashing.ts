import { createHash } from "node:crypto";
import { relative } from "node:path";
import { generateMessageId } from "@zintl/extractor";

export { generateMessageId };

/**
 * Standard SHA1 used for all Zintl hashing.
 */
export function sha1(content: string) {
  return createHash("sha1").update(content).digest("hex");
}

/**
 * Stable ID calculation for boundaries.
 * In production, it converts the path to project-relative and hashes it.
 */
export function calculateBoundaryId(boundaryId: string, root: string, isDev: boolean): string {
  if (isDev) return boundaryId;
  return calculateSafeBoundaryId(boundaryId, root);
}

/**
 * Syntax-safe ID calculation for production managers and loaders.
 * - In Dev Mode: Returns a sanitized version of the path-based ID (e.g. b_src_main_render)
 * - In Prod Mode: Returns a stable SHA1 hash.
 */
export function calculateSafeBoundaryId(
  boundaryId: string,
  root: string,
  isDev: boolean = false,
): string {
  // If it's already a safe ID (prefixed with b_ and followed by hash or sanitized path),
  // we check if it needs re-processing.
  if (boundaryId.startsWith("b_") && boundaryId.length === 14 && !isDev) {
    return boundaryId;
  }

  // Handle absolute paths by relative-izing them
  let stableId = boundaryId.includes("/")
    ? boundaryId.startsWith("/")
      ? relative(root, boundaryId)
      : boundaryId
    : boundaryId;

  // Strip extensions for stability across JS/TS moves
  stableId = stableId.replace(/\.(?:ts|tsx|js|jsx)$/, "");

  if (isDev) {
    // If it's already a safe ID (prefixed with b_), return as is
    if (boundaryId.startsWith("b_")) return boundaryId;

    // Sanitization: Replace characters that are invalid in JS identifiers with underscores
    // This preserves readability while keeping the code valid.
    const sanitized = stableId.replace(/[^a-zA-Z0-9]/g, "_");
    return "b_" + sanitized;
  }

  return "b_" + sha1(stableId).substring(0, 12);
}
