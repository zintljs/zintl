import type { ZintlFacet } from "@zintl/compiler";

interface ClientSpaFacetOptions {
  clientLocaleSync?: boolean;
}

export function clientSpaFacet(options: ClientSpaFacetOptions = {}): ZintlFacet {
  return {
    name: "client-spa",
    concern: "runtime",
    priority: 100,
    clientLocaleSync: options.clientLocaleSync !== undefined ? options.clientLocaleSync : true,
  };
}
