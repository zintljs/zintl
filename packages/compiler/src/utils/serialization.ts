/**
 * Comparison helper to sort strings without heavy internationalization localeCompare overhead,
 * satisfying strict ESLint require-array-sort-compare checks.
 */
export const compareStrings = (a: any, b: any): number => {
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
};

/**
 * Robust item comparison helper for sorting arrays. Supports sorting objects by their id or name
 * property, falling back to string representation comparison.
 */
const compareItems = (a: any, b: any): number => {
  if (a !== null && typeof a === "object" && b !== null && typeof b === "object") {
    if (typeof a.id === "string" && typeof b.id === "string") {
      return compareStrings(a.id, b.id);
    }
    if (typeof a.name === "string" && typeof b.name === "string") {
      return compareStrings(a.name, b.name);
    }
  }
  return compareStrings(a, b);
};

/**
 * Recursively sorts the keys of an object to ensure deterministic serialization.
 */
export function sortObjectKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map((i) => sortObjectKeys(i));
  } else if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort(compareStrings)
      .reduce((acc: any, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

/**
 * Recursively serializes any value (handling Maps and Sets) to a deterministic,
 * sorted plain JavaScript object/array representation.
 */
export function serializeDeterministic(val: any): any {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (val instanceof Map) {
    const obj: any = {};
    const sortedKeys = Array.from(val.keys()).sort(compareStrings);
    for (const key of sortedKeys) {
      obj[key] = serializeDeterministic(val.get(key));
    }
    return obj;
  }
  if (val instanceof Set) {
    return Array.from(val).map(serializeDeterministic).sort(compareItems);
  }
  if (Array.isArray(val)) {
    const mapped = val.map(serializeDeterministic);
    return mapped.sort(compareItems);
  }
  const obj: any = {};
  const sortedKeys = Object.keys(val).sort(compareStrings);
  for (const key of sortedKeys) {
    obj[key] = serializeDeterministic(val[key]);
  }
  return obj;
}
