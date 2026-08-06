import type { ZintlFacet } from "@zintljs/compiler";

export interface ClientSpaFacetOptions {
  /**
   * Keep the active locale in sync with the browser.
   *
   * Set `false` to install the facet without the listeners, when the app drives
   * locale changes entirely through `setLocale`.
   *
   * @default true
   */
  clientLocaleSync?: boolean;
}

/**
 * Client-side locale sync for single-page apps.
 *
 * Keeps the active locale following the browser: back/forward through
 * `popstate`, in-app navigation through a patched `pushState`, and external
 * changes to `<html lang>` through a `MutationObserver`. Without it, a locale in
 * the URL stops mattering the moment the router takes over.
 *
 * Only the code this facet enables is shipped, so a non-SPA build carries none
 * of it.
 *
 * Included in the built-in set for every project except Next.js, which handles routing
 * itself.
 */
export function clientSpaFacet(options: ClientSpaFacetOptions = {}): ZintlFacet {
  return {
    name: "client-spa",
    concern: "runtime",
    priority: 100,
    clientLocaleSync: options.clientLocaleSync !== undefined ? options.clientLocaleSync : true,
  };
}
