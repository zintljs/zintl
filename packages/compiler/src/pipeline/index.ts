/**
 * @module pipeline
 *
 * The Zintl Semantic Pipeline — a formal execution model for
 * deterministic source code transformation.
 *
 * Phases:
 *   1. OBSERVE  → FileObservation (parser-dependent, everything else is not)
 *   2. INTENT   → TransformIntent[] (decisions, no mutation)
 *   3. RESOLVE  → ResolvedPlan (conflict resolution, ordering)
 *   4. APPLY    → TransformResult (mechanical mutation)
 *   5. VALIDATE → ValidationResult (post-condition checks)
 */

// Re-export all types
export * from "./types.js";

// Phase 1: Observe
export { observe } from "./observe.js";

// Phase 2: Intent
export { formIntent, findEffectiveAnchor, resolveOwner, getReachableHandshake } from "./intent.js";

// Phase 3: Resolve
export { resolve } from "./resolve.js";

// Phase 4: Apply
export { apply } from "./apply.js";

// Phase 5: Validate
export { validate } from "./validate.js";
