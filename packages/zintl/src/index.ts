export type { ZintlPluginOptions, ZintlPluginFacetInput } from "./types.js";

// Re-export default facet factories and constants from @zintl/compiler
export {
  vanillaFacet,
  reactExtractionFacet,
  reactCodegenFacet,
  reactFacet,
  vueExtractionFacet,
  vueCodegenFacet,
  vueFacet,
  svelteExtractionFacet,
  svelteCodegenFacet,
  svelteFacet,
  htmlExtractionFacet,
  htmlProjectionFacet,
  htmlFacet,
  nextjsSsrFacet,
  nextjsExtractionFacet,
  nextjsRuntimeFacet,
  nextjsFacet,
  ssrWrappingFacet,
  ssrRuntimeFacet,
  ssrFacet,
  clientSpaFacet,
  viteFacet,
  assetsFacet,
} from "@zintl/compiler";
