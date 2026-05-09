/**
 * @module pipeline/intent
 * Phase 2: INTENT — Decision Formation. Pure function.
 */

import type { FileObservation, WorldState, TransformIntent, FormIntentFn } from "../types/index.js";
import {
  planAnchors,
  planSinks,
  planManualT,
  deduplicateManagerInjections,
} from "./intent-core.js";

export { resolveOwner, findEffectiveAnchor, getReachableHandshake } from "./intent-utils.js";

/**
 * Form transformation intents for a single file.
 */
export const formIntent: FormIntentFn = (
  observation: FileObservation,
  worldState: WorldState,
): TransformIntent[] => {
  const intents: TransformIntent[] = [];

  intents.push(...planAnchors(observation, worldState));
  intents.push(...planSinks(observation, worldState));
  intents.push(...planManualT(observation, worldState));

  const uniqueIntents = deduplicateManagerInjections(intents);

  // Plan Marker Removal
  if (observation.zintlImportLocation && uniqueIntents.length > 0) {
    uniqueIntents.push({
      type: "marker_removal",
      start: observation.zintlImportLocation.start,
      end: observation.zintlImportLocation.end,
      replacement: "",
      kind: "marker_removal",
    });
  }

  return uniqueIntents;
};
