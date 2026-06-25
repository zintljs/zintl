import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Client SPA runtime adapter.
 * Activates client-side locale sync: popstate listener, history.pushState
 * monkey-patch, MutationObserver for document.documentElement.lang changes.
 *
 * NOT needed for MPA apps with full page reloads — only SPA navigation.
 *
 * @example ["react", "client-spa", "vite"] — React SPA
 * @example ["vanilla", "client-spa", "vite"] — Vanilla SPA
 */
const clientSpaRuntimeAdapter: ZintlAdapter = {
  name: "client-spa",
  runtime: {
    clientLocaleSync: true,
  },
};

registerPreset("client-spa", () => [clientSpaRuntimeAdapter]);

export { clientSpaRuntimeAdapter };
