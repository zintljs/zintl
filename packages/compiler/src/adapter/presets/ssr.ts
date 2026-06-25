import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Generic SSR runtime adapter.
 * Activates server-side AsyncLocalStorage request scoping and stream injection.
 * Can be composed with any framework adapter.
 *
 * @example ["react", "ssr", "vite"] — React SSR app
 * @example ["vue", "ssr", "vite"]   — Vue SSR app
 */
const ssrRuntimeAdapter: ZintlAdapter = {
  name: "ssr",
  runtime: {
    serverRequestScope: true,
    streamInjection: true,
  },
};

registerPreset("ssr", () => [ssrRuntimeAdapter]);

export { ssrRuntimeAdapter };
