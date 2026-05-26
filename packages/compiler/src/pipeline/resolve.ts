/**
 * @module pipeline/resolve
 * Phase 3: RESOLVE — Consistency Phase. Pure function.
 */

import type {
  TransformIntent,
  FileObservation,
  ResolvedPlan,
  Diagnostic,
  ResolveFn,
  ZintlConfig,
  ZintlLogger,
} from "../types/index.js";
import { resolveImports, resolvePrepends } from "./resolve-imports.js";
import { resolveRewrites, resolveConflicts } from "./resolve-rewrites.js";

/**
 * Resolve transformation intents into a deterministic mutation plan.
 */
export const resolve: ResolveFn = (
  intents: TransformIntent[],
  observation: FileObservation,
  config: ZintlConfig,
  logger: ZintlLogger,
  filePath?: string,
): ResolvedPlan => {
  const diagnostics: Diagnostic[] = [];

  const imports = resolveImports(intents, observation);
  const prepends = resolvePrepends(intents, observation, logger);
  const rewrites = resolveRewrites(intents, config, filePath || observation.fileId);
  const finalRewrites = resolveConflicts(rewrites, diagnostics);

  logger.debug(
    `Resolved plan: ${imports.length} imports, ${prepends.length} prepends, ${finalRewrites.length} rewrites`,
  );

  // Final Sort for MagicString
  finalRewrites.sort((a, b) => b.start - a.start || b.priority - a.priority);

  return {
    imports,
    prepends,
    rewrites: finalRewrites,
    diagnostics,
  };
};
