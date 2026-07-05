import type { ZintlFacet } from "../types.js";

/**
 * Client SPA runtime contribution.
 * Activates client-side locale sync: popstate listener, history.pushState
 * monkey-patch, MutationObserver for document.documentElement.lang changes.
 *
 * NOT needed for MPA apps with full page reloads — only SPA navigation.
 */
export const clientSpaRuntimeFacet: ZintlFacet = {
  name: "client-spa",
  concern: "runtime",
  priority: 100,
  clientLocaleSync: true,
};
