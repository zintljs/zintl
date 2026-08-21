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
import { resolveRewrites, resolveConflicts, findCodegen } from "./resolve-rewrites.js";

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

  const codegen = findCodegen(filePath || observation.fileId, config);
  /**
   * A dialect whose translations must take a reactive dependency needs both
   * halves — the handle and the imports that build it — only when this file
   * actually renders something. A component with no sinks has nothing to track.
   */
  const needsReactiveBridge =
    !!codegen?.reactiveBridge && intents.some((i) => i.type === "sink_wrap");

  const imports = resolveImports(
    intents,
    observation,
    config.system?.clientReactivityImports,
    config.system?.serverComponents === true,
    needsReactiveBridge ? codegen!.reactiveBridge : undefined,
    codegen?.codegenImports,
  );
  const prepends = resolvePrepends(intents, observation, logger);
  if (needsReactiveBridge) {
    prepends.push({ code: codegen!.reactiveBridge!.setup });
  }
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
   *
   * **And only for a dialect that has a hook to call.** The emitted call is
   * React's `useSyncExternalStore` — Preact's `preact/compat` shim matches its
   * signature exactly, which is why one line serves both — but Solid has no such
   * hook at all. It writes JSX, so `componentFunctions` is non-empty and this
   * fired for it too, emitting a call to an undefined name that nothing imported:
   * a `ReferenceError` on first render. Vue and Svelte only escaped because their
   * SFCs have no component *functions* for the scan to find, which is a property
   * of their file format rather than a decision anyone made.
   *
   * So the condition is what it should always have been: inject the subscription
   * if the framework declared a hook to subscribe with. A dialect that declares
   * `reactiveBridge` instead — Vue, Solid — takes its dependency there, and
   * declares no `clientReactivityImports` precisely because it needs none.
   */
  const requiresClientDirective = config.system?.serverComponents === true;
  const hasClientReactivityHook =
    Object.keys(config.system?.clientReactivityImports ?? {}).length > 0;
  if (
    hasClientReactivityHook &&
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
