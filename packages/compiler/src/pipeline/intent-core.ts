import { generateMessageId } from "@zintl/extractor";
import { calculateSafeBoundaryId } from "../utils/hashing.js";
import type {
  FileObservation,
  WorldState,
  TransformIntent,
  ObservedSink,
  LoaderEntry,
  AnchorRewriteIntent,
} from "../types/index.js";
import {
  resolveKingdom,
  findEffectiveAnchor,
  generateManagerUrl,
  mapVariables,
  getReachableHandshake,
} from "./intent-utils.js";

/**
 * Ensures that manager injections are unique per owner in a file.
 */
export function deduplicateManagerInjections(intents: TransformIntent[]): TransformIntent[] {
  const finalIntents: TransformIntent[] = [];
  const injectedStables = new Set<string>();

  for (const intent of intents) {
    if (intent.type === "manager_injection") {
      if (!injectedStables.has(intent.stableId)) {
        injectedStables.add(intent.stableId);
        finalIntents.push(intent);
      }
      continue;
    }
    finalIntents.push(intent);
  }

  return finalIntents;
}

/**
 * Plan transformations for trust anchors.
 */
export function planAnchors(
  observation: FileObservation,
  worldState: WorldState,
): TransformIntent[] {
  const managerInjections: TransformIntent[] = [];
  const anchorRewritesByLocation = new Map<string, AnchorRewriteIntent>();

  for (const anchor of observation.anchors) {
    const { handshake, colonies } = getReachableHandshake(anchor.boundaryId, worldState);
    const allHandshake = [...handshake, ...colonies];
    const loadersMap = new Map<string, LoaderEntry>();
    const seenManagers = new Set<string>();

    const isBakeMode = !worldState.config.isDev && anchor.locale.type === "literal";

    for (const bId of allHandshake) {
      const ownerId = resolveKingdom(bId, worldState);
      const safeBId = calculateSafeBoundaryId(bId, worldState.config.root, worldState.config.isDev);
      const safeId = calculateSafeBoundaryId(
        ownerId,
        worldState.config.root,
        worldState.config.isDev,
      );
      const stableId = safeId;

      // Add specific boundary registration
      loadersMap.set(bId, { stableId, safeId, boundaryId: safeBId });

      // Ensure manager is injected (once per owner)
      if (!seenManagers.has(ownerId) && !isBakeMode) {
        seenManagers.add(ownerId);
        managerInjections.push({
          type: "manager_injection",
          ownerId,
          safeId,
          stableId,
          managerUrl: generateManagerUrl(ownerId, stableId, worldState),
          reason: "handshake",
        });
      }
    }

    const loaders = Array.from(loadersMap.values());
    if (anchor.originalName === "implicit-anchor" && loaders.length === 0) continue;

    const key = `${anchor.location.start}:${anchor.location.end}`;
    const existing = anchorRewritesByLocation.get(key);

    if (existing) {
      for (const loader of loaders) {
        if (!existing.loaders.some((l: LoaderEntry) => l.boundaryId === loader.boundaryId)) {
          existing.loaders.push(loader);
        }
      }
    } else {
      // In Production Mode, if it's a literal anchor, we remove it
      // to achieve Zero-Runtime.
      if (!worldState.config.isDev && anchor.locale.type === "literal") {
        anchorRewritesByLocation.set(key, {
          type: "marker_removal",
          start: anchor.statementLocation?.start ?? anchor.location.start,
          end: anchor.statementLocation?.end ?? anchor.location.end,
          replacement: "",
          kind: "marker_removal",
        } as any);
        continue;
      }

      anchorRewritesByLocation.set(key, {
        type: "anchor_rewrite",
        location: anchor.location,
        loaders: [...loaders],
        locale: anchor.locale,
        originalName: anchor.originalName,
        boundaryId: anchor.boundaryId,
      });
    }
  }

  return [...managerInjections, ...Array.from(anchorRewritesByLocation.values())];
}

/**
 * Plan transformations for UI sinks.
 */
export function planSinks(observation: FileObservation, worldState: WorldState): TransformIntent[] {
  const intents: TransformIntent[] = [];
  const { config, catalogs } = worldState;

  for (const sink of observation.sinks) {
    const messageId = generateMessageId(sink.text);
    const ownerId = resolveKingdom(sink.boundaryId, worldState);
    const anchor = findEffectiveAnchor(sink.boundaryId, worldState, observation, ownerId);
    const isDynamic = anchor?.locale.type === "expression";

    if (config.isDev || isDynamic || !anchor) {
      intents.push(createWrapIntent(sink, messageId, ownerId, worldState));
      const safeId = calculateSafeBoundaryId(ownerId, config.root, config.isDev);
      const stableId = safeId;
      intents.push({
        type: "manager_injection",
        ownerId,
        safeId,
        stableId,
        managerUrl: generateManagerUrl(ownerId, stableId, worldState),
        reason: "sink",
      });
      continue;
    }

    let locale = anchor?.locale.type === "literal" ? anchor.locale.value : config.sourceLocale;
    if (locale === "none") locale = config.sourceLocale;

    if (locale === config.sourceLocale) {
      intents.push({ type: "source_locale_passthrough", sink, reason: "source_locale_baking" });
      continue;
    }

    const translation = catalogs[sink.boundaryId]?.[sink.text];
    intents.push({
      type: "baking",
      sink,
      messageId,
      translation: translation !== undefined && translation !== "" ? translation : sink.text,
      variables: mapVariables(sink),
      isDev: config.isDev,
    });
  }

  return intents;
}

/**
 * Plan transformations for manual t() calls.
 */
export function planManualT(
  observation: FileObservation,
  worldState: WorldState,
): TransformIntent[] {
  const intents: TransformIntent[] = [];

  for (const manual of observation.manualTranslations) {
    const messageId = generateMessageId(manual.key, "Manual");
    const ownerId = resolveKingdom(manual.boundaryId, worldState);
    const safeId = calculateSafeBoundaryId(
      ownerId,
      worldState.config.root,
      worldState.config.isDev,
    );
    const safeFileBoundaryId = calculateSafeBoundaryId(
      manual.boundaryId,
      worldState.config.root,
      worldState.config.isDev,
    );
    const boundaryId = safeFileBoundaryId;

    if (!worldState.config.isDev) {
      const anchor = findEffectiveAnchor(manual.boundaryId, worldState, observation, ownerId);
      const isDynamic = anchor?.locale.type === "expression";

      if (!isDynamic && anchor) {
        let locale =
          anchor.locale.type === "literal" ? anchor.locale.value : worldState.config.sourceLocale;
        if (locale === "none") locale = worldState.config.sourceLocale;

        if (locale === worldState.config.sourceLocale) {
          intents.push({
            type: "source_locale_passthrough",
            sink: {
              text: manual.key,
              location: manual.location,
              boundaryId: manual.boundaryId,
              variables: [], // Manual T params are already in source
              sinkType: "StringLiteral",
              isFragment: false,
            } as any,
            reason: "source_locale_baking",
          });
          continue;
        }

        const translation = worldState.catalogs[manual.boundaryId]?.[manual.key];
        intents.push({
          type: "baking",
          sink: {
            text: manual.key,
            location: manual.location,
            boundaryId: manual.boundaryId,
            variables: [],
            sinkType: "StringLiteral",
            isFragment: false,
          } as any,
          messageId,
          translation: translation !== undefined && translation !== "" ? translation : manual.key,
          variables: [],
          isDev: false,
        });
        continue;
      }
    }

    intents.push({
      type: "manual_t_rewrite",
      location: manual.location,
      originalKey: manual.key,
      messageId,
      boundaryId,
      ownerId,
      safeId,
      paramsSource: manual.paramsSource,
      isDev: worldState.config.isDev,
    });

    const stableId = safeId;
    intents.push({
      type: "manager_injection",
      ownerId,
      safeId,
      stableId,
      managerUrl: generateManagerUrl(ownerId, stableId, worldState),
      reason: "manual_t",
    });
  }

  return intents;
}

function createWrapIntent(
  sink: ObservedSink,
  messageId: string,
  ownerId: string,
  worldState: WorldState,
): TransformIntent {
  const safeId = calculateSafeBoundaryId(ownerId, worldState.config.root, worldState.config.isDev);
  const safeFileBoundaryId = calculateSafeBoundaryId(
    sink.boundaryId,
    worldState.config.root,
    worldState.config.isDev,
  );

  return {
    type: "sink_wrap",
    sink,
    messageId,
    boundaryId: safeFileBoundaryId,
    ownerId,
    safeId,
    variables: mapVariables(sink),
    isDev: worldState.config.isDev,
  };
}
