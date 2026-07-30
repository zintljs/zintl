/**
 * `extract()` with a declared sink world.
 *
 * The extractor no longer defaults to `["vanilla", "react", "html"]` — a
 * framework-blind executor has nothing sensible to guess, so a bare `extract()`
 * now finds no sinks at all. Tests that only care about *how* extraction works,
 * not *which* sinks are configured, use this wrapper to declare the ordinary
 * DOM + JSX + HTML world once.
 *
 * Tests exercising specific descriptor sets should call `extract()` directly.
 */
import { extract } from "../../parser.js";
import { resolveTargets } from "../../targets.js";
import type {
  CompiledExtractionState,
  ExtractionOptions,
  ExtractionResult,
  TargetDescriptor,
} from "../../types.js";
import { BASE_TARGETS } from "./fixtures.js";

export function extractBase(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  return extract(code, filePath, fileBoundaryId, { targets: BASE_TARGETS, ...options });
}

/** Options preloaded with the base sink world, for direct ExtractionContext use. */
export function baseOptions(options: ExtractionOptions = {}): ExtractionOptions {
  return { targets: BASE_TARGETS, ...options };
}

/**
 * Build a `CompiledExtractionState` the way the compiler's
 * `compileExtractionState` does: compile the descriptors, then attach the
 * caller's rules to a *copy*.
 *
 * `resolveTargets` memoizes and returns a shared instance, so the copy matters —
 * writing rules onto it directly would leak between tests.
 */
export function baseState(
  overrides: Partial<CompiledExtractionState> = {},
): CompiledExtractionState {
  const { targets, ...rules } = overrides as Partial<CompiledExtractionState> & {
    targets?: TargetDescriptor[];
  };
  return {
    ...resolveTargets(targets ?? BASE_TARGETS),
    ...rules,
  };
}
