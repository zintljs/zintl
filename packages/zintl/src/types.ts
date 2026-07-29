import type { CompilerOptions, AssetTargetConfig } from "@zintl/compiler";
import type { ZintlFacet } from "@zintl/compiler/facets";

export type FacetsInput =
  | "auto"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | FacetsInput[];

export interface Options extends Omit<CompilerOptions, "facets"> {
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  verifyIntegrity?: boolean;
  facets?: FacetsInput[];
}
