import { registerLoader, type Loader } from "./store.js";

/**
 * A helper for the Zintl compiler to register a boundary loader.
 * This is designed to be called with a minimal footprint in the transformed source.
 */
export function registerZintlLoader(boundaryId: string, loader: Loader) {
  return registerLoader(boundaryId, loader);
}
