import type { SourceLocation } from "./ast.js";

/**
 * A fully resolved, validated, and ordered transformation plan.
 */
export interface ResolvedPlan {
  imports: ResolvedImport[];
  prepends: ResolvedPrepend[];
  rewrites: ResolvedRewrite[];
  diagnostics: Diagnostic[];
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
  kind: "anchor" | "sink_wrap" | "manual_t" | "bake" | "quote_convert" | "passthrough";
  priority: number;
}

export interface Diagnostic {
  severity: "info" | "warn" | "error";
  message: string;
  location?: SourceLocation;
  code?: string;
}
