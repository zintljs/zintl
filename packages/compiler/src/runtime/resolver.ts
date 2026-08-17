/**
 * Build-time sentinel, substituted to a literal `true`/`false` by
 * `getRuntimeCode()` before this module is ever served.
 *
 * A literal is the point: `typeof process !== "undefined" && ...` looked like a
 * safe dev guard, but `process` is undefined in browsers, so it short-circuited
 * to false and every branch behind it was dead client-side. With a literal,
 * production builds eliminate the branch outright and dev builds keep it.
 */
declare const __ZINTL_DEV__: boolean;
import { getActiveInstance } from "./store.js";

export function _t(
  key: string,
  params: Record<string, any> = {},
  options?: { _mgr?: any; _bId?: string },
): string {
  const instance = getActiveInstance();
  const catalogs = instance.catalogs;
  const locale = instance.locale;

  // Merge options into effective params to ensure _mgr and _bId are found regardless of argument placement
  const effectiveParams = options ? { ...params, ...options } : params;

  // Translation Scoping
  const mgr = effectiveParams._mgr;
  const boundaryId = mgr?.id;
  const targetBId = effectiveParams._bId || boundaryId;

  // Scoped Lookup (Flattened: catalogs[locale][targetId][key])
  const boundaryCatalog = targetBId ? catalogs[locale]?.[targetBId] : undefined;
  let message = boundaryCatalog ? boundaryCatalog[key] : undefined;

  if (message === undefined) {
    if (mgr) {
      if (typeof window === "undefined") {
        if (mgr.loader) {
          try {
            const result = instance.claimHydrationAttempt(locale, targetBId || boundaryId, key)
              ? mgr.loader(locale)
              : undefined;
            if (result && typeof (result as any).then !== "function") {
              instance.addCatalogs({ [locale]: result } as any);
              const boundaryCatalogAfter = targetBId
                ? instance.catalogs[locale]?.[targetBId]
                : undefined;
              message = boundaryCatalogAfter ? boundaryCatalogAfter[key] : undefined;
            } else if (result && typeof (result as any).then === "function") {
              void instance.loadLazyBoundary(mgr.id, mgr.loader);
            }
          } catch {}
        }
      } else {
        if (mgr.loader) {
          /**
           * Trigger the load now, then re-read — the same shape the server
           * branch above already uses.
           *
           * Deferring into a microtask meant a *synchronous* loader could not
           * satisfy this call, so the first render tick after a hot update
           * registered a new loader always returned "" even though the strings
           * were available on that very tick. `loadLazyBoundary` handles the
           * async case internally, so nothing is lost by calling it inline.
           */
          try {
            /**
             * One attempt per boundary between catalog changes.
             *
             * Re-reading immediately is what lets a synchronous loader satisfy
             * the first render tick, and that is worth keeping. Re-*triggering*
             * on every render is not: when the key is genuinely absent the load
             * can never satisfy it, and each attempt announces a change that
             * renders again. See `I18nStore.hydrationAttempts` — with a
             * reactive framework subscribed this closes into a loop measured at
             * six figures of console output.
             */
            if (instance.claimHydrationAttempt(locale, targetBId || boundaryId, key)) {
              instance.loadLazyBoundary(mgr.id, mgr.loader);
            }
            const boundaryCatalogAfter = targetBId
              ? instance.catalogs[locale]?.[targetBId]
              : undefined;
            if (boundaryCatalogAfter) message = boundaryCatalogAfter[key];
          } catch {}
        }
      }

      if (message === undefined) {
        if (__ZINTL_DEV__) {
          console.warn(
            `[Zintl] Missing key "${key}" in boundary "${targetBId || boundaryId}". Triggering hydration...`,
          );
        }
        return ``;
      }
    } else {
      if (__ZINTL_DEV__) {
        console.warn(`[Zintl] Missing key "${key}" and no manager provided.`);
      }
      return ``;
    }
  }

  if (typeof message === "function") {
    return message(params);
  }

  if (typeof message !== "string") {
    return "";
  }

  // Remove _mgr, _bId and _tags from params before interpolation
  const { _mgr, _bId, _tags, ...restParams } = effectiveParams;

  let interpolated = interpolate(message, restParams);
  if (_tags && Array.isArray(_tags)) {
    for (const entry of _tags) {
      interpolated = interpolated.replaceAll(`<${entry.alias}/>`, entry.originalOpen);
      interpolated = interpolated.replaceAll(`<${entry.alias} />`, entry.originalOpen);
      interpolated = interpolated.replaceAll(`<${entry.alias}>`, entry.originalOpen);
      interpolated = interpolated.replaceAll(`</${entry.alias}>`, `</${entry.tagName}>`);
    }
  }

  return interpolated;
}

function interpolate(message: string | Function, params: Record<string, any>): string {
  if (message === null || message === undefined) {
    return "";
  }
  const str = String(message);
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key]?.toString() ?? match;
  });
}
