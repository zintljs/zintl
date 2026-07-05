import type { CompilerOptions, ZintlFacet, AssetTargetConfig } from "@zintl/compiler";

export type ZintlPluginFacetInput =
  | "auto"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | ZintlPluginFacetInput[];

export interface ZintlPluginOptions extends Omit<CompilerOptions, "facets"> {
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  verifyIntegrity?: boolean;
  facets?: ZintlPluginFacetInput[];
}
