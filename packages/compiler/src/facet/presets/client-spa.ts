import type { ZintlFacet } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Client SPA runtime contribution.
 * Activates client-side locale sync: popstate listener, history.pushState
 * monkey-patch, MutationObserver for document.documentElement.lang changes.
 *
 * NOT needed for MPA apps with full page reloads — only SPA navigation.
 */
const clientSpaRuntimeFacet: ZintlFacet = {
  name: "client-spa",
  concern: "runtime",
  priority: 100,
  clientLocaleSync: true,
};

registerPreset("client-spa", () => [clientSpaRuntimeFacet]);

export { clientSpaRuntimeFacet };
