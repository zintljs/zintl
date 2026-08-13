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

  const imports = resolveImports(
    intents,
    observation,
    config.system?.clientReactivityImports,
    config.system?.serverComponents === true,
  );
  const prepends = resolvePrepends(intents, observation, logger);
  const rewrites = resolveRewrites(intents, config, filePath || observation.fileId);

  /**
   * Subscribe every component to the store, unless the framework says some
   * components are not client components.
   *
   * This used to require `observation.isClientComponent`, which is literally
   * `code.includes('"use client"')` — a React Server Components directive. A
   * plain React app never writes it, so reactivity was injected into exactly one
   * file in this entire repository and every SPA silently subscribed to nothing.
   * Invisible on Vite, whose module ordering makes the first render correct;
   * fatal on Rspack, where a catalog arriving after the render had nothing to
   * repaint it (ledger L-030, L-032).
   *
   * The directive is only meaningful where server components exist, so that is
   * now what gates it — declared by the framework's own facet rather than
   * inferred from a string in the file.
   */
  const requiresClientDirective = config.system?.serverComponents === true;
  if (
    (observation.isClientComponent || !requiresClientDirective) &&
    observation.componentFunctions &&
    observation.componentFunctions.length > 0
  ) {
    for (const pos of observation.componentFunctions) {
      rewrites.push({
        start: pos,
        end: pos,
        replacement: "\n  useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion);\n",
        kind: "client_reactivity",
        priority: 90,
      });
    }
  }

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
