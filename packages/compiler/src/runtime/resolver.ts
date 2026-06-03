declare const process: any;
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
      // Self-registration: If a manager is passed and ID is missing, register it.
      void instance.registerLoader(mgr.id, mgr.loader);
      const boundaryCatalogAfter = targetBId ? instance.catalogs[locale]?.[targetBId] : undefined;
      message = boundaryCatalogAfter ? boundaryCatalogAfter[key] : undefined;
      if (message === undefined) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          console.warn(
            `[Zintl] Missing key "${key}" in boundary "${boundaryId}". Triggering hydration...`,
          );
        }
        // We still return fallback because loader is async, but this triggers the network.
        return ``;
      }
    } else {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
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
