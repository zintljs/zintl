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
    if (anchor.locale.type === "literal" && anchor.locale.value === "*") {
      const isNestedInFunction = !anchor.isTopLevel || anchor.boundaryId.includes(":");
      if (isNestedInFunction) {
        throw new Error(
          `Zintl Sovereign Error: Sovereign anchor 'zintl("*")' is only valid at the root module level. Found nested sovereign anchor inside a function scope in file: ${observation.fileId}`,
        );
      }

      const isImportedSubordinate = Object.entries(worldState.dependencyGraph || {}).some(
        ([parentId, deps]) => {
          if (parentId === observation.fileId) return false;
          return deps.some((d) => {
            let depFileId = d.id;
            if (!depFileId) return false;
            if (depFileId.startsWith(".")) {
              const parentDir = parentId.includes("/")
                ? parentId.substring(0, parentId.lastIndexOf("/"))
                : "";
              depFileId = parentDir
                ? `${parentDir}/${depFileId.replace(/^\.\//, "")}`
                : depFileId.replace(/^\.\//, "");
              while (depFileId.includes("/../")) {
                depFileId = depFileId.replace(/[^/]+\/\.\.\//, "");
              }
            }
            const resolvedDepId = depFileId.replace(/\.(?:ts|tsx|js|jsx)$/, "").replace(/^\/+/, "");
            return resolvedDepId === observation.fileId;
          });
        },
      );
      if (isImportedSubordinate) {
        throw new Error(
          `Zintl Sovereign Error: Sovereign anchor 'zintl("*")' is only valid at the root entry point. Found illegal sovereign anchor in subordinate/imported file: ${observation.fileId}`,
        );
      }
    }

    const { handshake, colonies } = getReachableHandshake(anchor.boundaryId, worldState);
    const allHandshake = [...handshake, ...colonies];
    const loadersMap = new Map<string, LoaderEntry>();
    const seenManagers = new Set<string>();

    const isContextual =
      anchor.locale.type === "none" ||
      (anchor.locale.type === "expression" && !anchor.locale.source);
    const isBakeMode =
      !worldState.config.isDev &&
      worldState.config.multiplex !== false &&
      (anchor.locale.type === "literal" || (isContextual && !!worldState.config.bakedLocale));

    for (const bId of allHandshake) {
      const ownerId = resolveKingdom(bId, worldState);
      let kingdomHasActiveTranslations = false;
      for (const [fId, meta] of Object.entries(worldState.metadataGraph)) {
        if (resolveKingdom(fId, worldState) === ownerId) {
          if (meta.needsLoader) {
            kingdomHasActiveTranslations = true;
            break;
          }
          const deps = worldState.dependencyGraph[fId] || [];
          const hasAsset = deps.some((d) => {
            const cleanId = d.id?.split("?")[0] || "";
            return cleanId.endsWith(".md") || cleanId.endsWith(".txt");
          });
          if (hasAsset) {
            kingdomHasActiveTranslations = true;
            break;
          }
        }
      }

      if (!kingdomHasActiveTranslations) {
        continue;
      }
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
      // In Production Mode, if it's a literal or contextual baked anchor, we remove it
      // to achieve Zero-Runtime.
      if (isBakeMode) {
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
    const isContextual =
      anchor?.locale.type === "none" ||
      (anchor?.locale.type === "expression" && !anchor?.locale.source);
    const isDynamic = anchor?.locale.type === "expression" && !isContextual;

    if (config.isDev || isDynamic || !anchor || (isContextual && !config.bakedLocale)) {
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
      tagMap: sink.tagMap,
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
      const isContextual =
        anchor?.locale.type === "none" ||
        (anchor?.locale.type === "expression" && !anchor?.locale.source);
      const isDynamic = anchor?.locale.type === "expression" && !isContextual;

      if (!isDynamic && anchor && (!isContextual || !!worldState.config.bakedLocale)) {
        let locale =
          anchor.locale.type === "literal" ? anchor.locale.value : worldState.config.sourceLocale;

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
