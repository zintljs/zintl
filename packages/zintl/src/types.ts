import type { AssetTargetConfig, CompilerOptions, ZintlFacet } from "@zintl/compiler";

/**
 * What a user may write in `facets: [...]`.
 *
 * Accepts the `"auto"` sentinel (expanded by framework detection), bare facets,
 * arrays, and thunks — all flattened during assembly before resolution.
 */
export type FacetsInput =
  | "auto"
  | ZintlFacet
  | ZintlFacet[]
  | (() => ZintlFacet | ZintlFacet[])
  | FacetsInput[];

/**
 * The plugin's public options.
 *
 * `capabilities` is omitted deliberately: it is the *output* of this plugin's
 * facet resolution and the *input* to the compiler. Users declare `facets`; the
 * plugin turns them into capabilities and hands those to `ZintlCompiler`.
 */
export interface Options extends Omit<CompilerOptions, "capabilities"> {
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  facets?: FacetsInput[];
}
