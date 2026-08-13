import { RUNTIME_PACKAGE } from "@zintljs/extractor";
import type {
  TransformIntent,
  FileObservation,
  ResolvedImport,
  ResolvedPrepend,
  ZintlLogger,
} from "../types/index.js";

const RUNTIME_INTERNAL_PACKAGE = "virtual:zintl/runtime/internal";
const MACRO_PACKAGE = "zintljs/macro";

/**
 * Resolve imports for the transformation plan.
 */
export function resolveImports(
  intents: TransformIntent[],
  observation: FileObservation,
  clientReactivityImports: Record<string, string[]> = {},
  serverComponents = false,
): ResolvedImport[] {
  const specifiersBySource: Record<string, Set<string>> = {};

  const needsT = intents.some((i) => i.type === "sink_wrap" || i.type === "manual_t_rewrite");
  const needsLoader = intents.some((i) => i.type === "anchor_rewrite");
  /**
   * Must agree exactly with the injection gate in `resolve.ts`: if these two
   * disagree, a file either imports `useSyncExternalStore` without calling it or
   * calls it without importing it. See that gate for why the `"use client"`
   * directive is no longer the condition.
   */
  const autoClientReactivity =
    (observation.isClientComponent || !serverComponents) &&
    observation.componentFunctions &&
    observation.componentFunctions.length > 0;

  if (needsT || needsLoader || autoClientReactivity) {
    if (!specifiersBySource[RUNTIME_INTERNAL_PACKAGE]) {
      specifiersBySource[RUNTIME_INTERNAL_PACKAGE] = new Set();
    }
    if (needsT) specifiersBySource[RUNTIME_INTERNAL_PACKAGE].add("_t");
    if (needsLoader) specifiersBySource[RUNTIME_INTERNAL_PACKAGE].add("loadI18nInstance");
    if (autoClientReactivity) {
      specifiersBySource[RUNTIME_INTERNAL_PACKAGE].add("subscribe");
      specifiersBySource[RUNTIME_INTERNAL_PACKAGE].add("getStoreVersion");
      // Which framework hook this needs is the framework's business, not ours.
      // Declared by the codegen facet (see CodegenFacet.clientReactivityImports).
      for (const [source, specifiers] of Object.entries(clientReactivityImports)) {
        if (!specifiersBySource[source]) specifiersBySource[source] = new Set();
        for (const spec of specifiers) specifiersBySource[source].add(spec);
      }
    }
  }

  for (const intent of intents) {
    if (intent.type === "import") {
      if (!specifiersBySource[intent.source]) specifiersBySource[intent.source] = new Set();
      for (const s of intent.specifiers) specifiersBySource[intent.source].add(s);
    }
  }

  if (
    observation.zintlImportLocation &&
    !specifiersBySource[MACRO_PACKAGE] &&
    !specifiersBySource[RUNTIME_PACKAGE]
  ) {
    const importSource =
      observation.imports?.find((i) => i.source === MACRO_PACKAGE || i.source === RUNTIME_PACKAGE)
        ?.source || RUNTIME_PACKAGE;
    specifiersBySource[importSource] = new Set();
  }

  for (const exp of observation.imports || []) {
    if (
      exp.source === RUNTIME_PACKAGE ||
      exp.source === MACRO_PACKAGE ||
      exp.source === RUNTIME_INTERNAL_PACKAGE
    ) {
      const source = exp.source;
      if (!specifiersBySource[source]) specifiersBySource[source] = new Set();
      for (const s of exp.specifiers) {
        if (
          (source === RUNTIME_PACKAGE || source === MACRO_PACKAGE) &&
          (s.imported === "_t" ||
            s.imported === "loadI18nInstance" ||
            s.imported === "getLocale" ||
            s.imported === "setLocale" ||
            s.imported === "subscribe" ||
            s.imported === "addCatalogs" ||
            s.imported === "getStoreVersion" ||
            s.imported === "registerZintlLoader")
        ) {
          if (!specifiersBySource[RUNTIME_INTERNAL_PACKAGE]) {
            specifiersBySource[RUNTIME_INTERNAL_PACKAGE] = new Set();
          }
          specifiersBySource[RUNTIME_INTERNAL_PACKAGE].add(s.imported);
        } else {
          specifiersBySource[source].add(s.imported);
        }
      }
    }
  }

  const result: ResolvedImport[] = [];
  const sources = Object.keys(specifiersBySource).sort((a) =>
    a === RUNTIME_INTERNAL_PACKAGE ? 1 : -1,
  );

  for (const source of sources) {
    const specifiers = specifiersBySource[source];
    const allExisting = (observation.imports || []).filter((i) => i.source === source);

    if (source === RUNTIME_INTERNAL_PACKAGE && allExisting.length === 0) {
      result.push({ source, specifiers: Array.from(specifiers), strategy: "new" });
      continue;
    }

    if (allExisting.length > 0) {
      const primary = allExisting[0];
      const mergedSpecifiers = new Set<string>();

      for (const exp of allExisting) {
        for (const s of exp.specifiers) {
          if (
            (source === RUNTIME_PACKAGE || source === MACRO_PACKAGE) &&
            (s.imported === "t" || s.imported === "zintl")
          )
            continue;
          if (
            (source === RUNTIME_PACKAGE || source === MACRO_PACKAGE) &&
            (s.imported === "_t" || s.imported === "loadI18nInstance")
          )
            continue;
          mergedSpecifiers.add(s.imported);
        }
      }

      for (const s of specifiers) mergedSpecifiers.add(s);
      const finalSpecifiers = Array.from(mergedSpecifiers);

      result.push({
        source,
        specifiers: finalSpecifiers,
        strategy: "replace",
        location: primary.location,
      });

      for (let i = 1; i < allExisting.length; i++) {
        const loc = allExisting[i].location;
        if (loc.start === loc.end) continue;
        result.push({ source, specifiers: [], strategy: "replace", location: loc });
      }
    } else if (specifiers.size > 0) {
      result.push({ source, specifiers: Array.from(specifiers), strategy: "new" });
    }
  }

  const finalResult: ResolvedImport[] = [];
  const seenSources = new Set<string>();
  for (const imp of result) {
    if (!seenSources.has(imp.source)) {
      seenSources.add(imp.source);
      finalResult.push(imp);
    }
  }

  return finalResult;
}

/**
 * Resolve manager prepends.
 */
export function resolvePrepends(
  intents: TransformIntent[],
  observation: FileObservation,
  _logger: ZintlLogger,
): ResolvedPrepend[] {
  const seenSafeIds = new Set<string>();
  const prepends: ResolvedPrepend[] = [];

  for (const intent of intents) {
    if (intent.type === "manager_injection" && !seenSafeIds.has(intent.safeId)) {
      const alreadyImported = observation.imports.some(
        (imp) =>
          imp.source.includes("virtual:zintl/manager/") && imp.source.includes(intent.safeId),
      );

      if (!alreadyImported) {
        seenSafeIds.add(intent.safeId);
        prepends.push({
          code: `import _zintl_mgr_${intent.safeId} from ${JSON.stringify(intent.managerUrl)};`,
        });
      }
    }
  }

  return prepends;
}
