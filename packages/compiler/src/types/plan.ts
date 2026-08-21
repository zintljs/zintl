import type { SourceLocation } from "./ast.js";

/**
 * A fully resolved, validated, and ordered transformation plan.
 */
export interface ResolvedPlan {
  imports: ResolvedImport[];
  prepends: ResolvedPrepend[];
  rewrites: ResolvedRewrite[];
  diagnostics: Diagnostic[];
  /**
   * Whether this file's translations redraw without the module running again.
   *
   * True when the plan gave the file a way to observe the store — a reactive
   * bridge read spliced into its `_t` calls, or a subscription hook injected
   * into its components. Both are decided here and were, until now, thrown away
   * once the rewrites were emitted.
   *
   * A host's update applier reads it to answer a question it cannot answer for
   * itself: whether a catalog edit needs this module re-executed. "The framework
   * can repaint" is a project-level fact and is not enough — a module holding a
   * bare `t()` at top level has no component to subscribe and no bridge read, so
   * nothing observes the store and skipping its invalidation loses the edit
   * silently. `catalog_hmr.test.ts` is that module, and it is why this exists.
   *
   * Optional, and **absent means false** — deliberately the safe direction. A
   * plan that never set it is one nobody has reasoned about, and the answer for
   * an unknown plan has to be "invalidate anyway": a needless invalidation costs
   * a re-execution, while a wrongly skipped one loses a translator's edit with
   * no error at all.
   */
  repaintsWithoutReexecution?: boolean;
}

export interface ResolvedImport {
  source: string;
  specifiers: string[];
  location?: SourceLocation;
  strategy: "merge" | "replace" | "new";
}

export interface ResolvedPrepend {
  code: string;
}

export interface ResolvedRewrite {
  start: number;
  end: number;
  replacement: string;
  kind:
    | "anchor"
    | "sink_wrap"
    | "manual_t"
    | "bake"
    | "quote_convert"
    | "passthrough"
    | "client_reactivity";
  priority: number;
}

export interface Diagnostic {
  severity: "info" | "warn" | "error";
  message: string;
  location?: SourceLocation;
  code?: string;
}
