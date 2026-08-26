import type { Manifest } from "../reconcile.js";
import type { LogLevel, ZintlLogger } from "@zintljs/extractor";
import type { DependencyGraph, MetadataGraph, BoundaryGraph, ChunkGraph } from "./graph.js";
import type { FileObservation } from "./observation.js";
import type { TransformIntent } from "./intent.js";
import type { ResolvedPlan } from "./plan.js";
import type { TransformResult, ValidationResult } from "./result.js";
import type { CapabilityFlags, CompilerSystemView } from "./capabilities.js";
import type { CatalogFormatContext } from "./compiler.js";

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
  catalogs: Record<string, Record<string, string>>;
  logger: ZintlLogger;
}

/** Compiler configuration for intent formation decisions. */
export interface ZintlConfig {
  sourceLocale: string;
  locales: string[];
  outputDir: string;
  isDev: boolean;
  root: string;
  extensions?: string[];

  catalogFormat?: string | ((ctx: CatalogFormatContext) => string);
  similarityThreshold?: number;
  logLevel?: LogLevel;
  debug?: boolean | string;
  bakedLocale?: string;
  multiplex?: boolean;
  /**
   * Whether a content facet owns this file, asked rather than guessed.
   *
   * The pipeline needs to recognise a dependency on localizable content, and
   * tested `.md`/`.txt` by hand to do it — so a project targeting anything else
   * had its boundaries judged to carry no translations and got no manager
   * generated at all. The page then rendered a pseudo-localized key and the only
   * clue was "no manager provided", four layers from the cause.
   *
   * Supplied by the compiler with a context already bound, so a hot traversal
   * pays for one predicate rather than a context per dependency edge.
   */
  ownsContent?: (filePath: string) => boolean;

  // ── Resolved Capability State ──────────────────────────────────────
  /**
   * Pre-resolved capability flags. Subsystems read this — never raw facets.
   * Resolved by the host plugin and handed to the ZintlCompiler constructor.
   */
  capabilities?: CapabilityFlags;
  /**
   * Merged, ready-to-call system view. Subsystems call this — never raw facets.
   * Resolved by the host plugin and handed to the ZintlCompiler constructor.
   */
  system?: CompilerSystemView;
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
