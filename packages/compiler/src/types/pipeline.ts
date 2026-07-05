import type { Manifest } from "../reconcile.js";
import type { LogLevel, ZintlLogger } from "@zintl/extractor";
import type { DependencyGraph, MetadataGraph, BoundaryGraph, ChunkGraph } from "./graph.js";
import type { FileObservation } from "./observation.js";
import type { TransformIntent } from "./intent.js";
import type { ResolvedPlan } from "./plan.js";
import type { TransformResult, ValidationResult } from "./result.js";
import type { ResolvedCapabilities, ResolvedFacetSystem } from "../facet/index.js";

/**
 * The immutable world state available during intent formation.
 */
export interface WorldState {
  manifest: Manifest;
  dependencyGraph: DependencyGraph;
  metadataGraph: MetadataGraph;
  boundaryGraph: BoundaryGraph;
  chunkGraph: ChunkGraph;
  config: ZintlConfig;
  catalogs: Record<string, Record<string, any>>;
  logger: ZintlLogger;
}

/** Compiler configuration for intent formation decisions. */
export interface ZintlConfig {
  sourceLocale: string;
  locales: string[];
  outputDir: string;
  isDev: boolean;
  root: string;
  catalogFormat?: string | ((ctx: any) => string);
  similarityThreshold?: number;
  logLevel?: LogLevel;
  debug?: boolean | string;
  bakedLocale?: string;
  multiplex?: boolean;
  extensions?: string[];

  // ── Resolved Facet State (Phase 2+) ────────────────────────────────
  /**
   * Pre-resolved capability flags. Subsystems read this — never raw facets.
   * Populated by ZintlCompiler constructor after resolveFacets() call.
   */
  capabilities?: ResolvedCapabilities;
  /**
   * Merged, ready-to-call system view. Subsystems call this — never raw facets.
   * Populated by ZintlCompiler constructor after resolveFacets() call.
   */
  system?: ResolvedFacetSystem;
}

export type FormIntentFn = (
  observation: FileObservation,
  worldState: WorldState,
) => TransformIntent[];

export type ResolveFn = (
  intents: TransformIntent[],
  observation: FileObservation,
  config: ZintlConfig,
  logger: ZintlLogger,
  filePath?: string,
) => ResolvedPlan;

export type ApplyFn = (
  source: string,
  plan: ResolvedPlan,
  logger: ZintlLogger,
  filePath?: string,
  config?: ZintlConfig,
) => TransformResult;

export type ValidateFn = (
  result: TransformResult,
  plan: ResolvedPlan,
  observation: FileObservation,
  logger: ZintlLogger,
) => ValidationResult;
