import { resolveTargets } from "@zintl/extractor";
import type {
  CompiledExtractionState,
  MustacheRule,
  SfcRule,
  SuppressionRule,
  TargetDescriptor,
} from "../types/capabilities.js";

/** The declarative extraction inputs a resolved facet set contributes. */
export interface ExtractionContribution {
  extractionTargets: TargetDescriptor[];
  sfcRules: SfcRule[];
  suppressionRules: SuppressionRule[];
  mustacheRules: MustacheRule[];
}

/**
 * Compile declarative extraction descriptors into the lookup structures the
 * extractor executes against.
 *
 * This lives in the compiler, not the plugin, for one reason: the host plugin
 * must never depend on `@zintl/extractor`. The plugin decides *which* facets
 * exist and merges their declarations; turning those declarations into sets,
 * maps and a fast-path regex is mechanical work, and mechanical work is exactly
 * what "a little smart" means for this layer.
 *
 * The returned state is always a fresh object. `resolveTargets` memoizes and
 * hands back a shared mutable instance, so writing the rule arrays onto it
 * directly — as the old facet resolver did — let two compilers with identical
 * descriptors but different facet rules silently clobber each other.
 */
export function compileExtractionState(
  contribution: ExtractionContribution,
): CompiledExtractionState {
  const compiled = resolveTargets([...contribution.extractionTargets]);

  return {
    ...compiled,
    sfcRules: contribution.sfcRules,
    suppressionRules: contribution.suppressionRules,
    mustacheRules: contribution.mustacheRules,
  };
}
