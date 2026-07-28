import type { CompilerOptions, AssetTargetConfig } from "@zintl/compiler";
import type { ZintlPluginFacetInput } from "./facets.ts";
export interface ZintlPluginOptions extends Omit<CompilerOptions, "facets"> {
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  verifyIntegrity?: boolean;
  facets?: ZintlPluginFacetInput[];
}

export * from "./macro.js";
