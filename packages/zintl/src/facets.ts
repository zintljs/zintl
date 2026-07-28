import type { ZintlFacet } from "@zintl/compiler/facets";

export * from "@zintl/compiler/facets";

export type ZintlPluginFacetInput =
  | "auto"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | ZintlPluginFacetInput[];
