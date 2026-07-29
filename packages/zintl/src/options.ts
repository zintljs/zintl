import { type Options } from "./types.ts";

export function resolveOptions(options?: Options): Options {
  //   const {
  //     sourceLocale = "en",
  //     locales = ["en"],
  //     outputDir,
  //     catalogFormat,
  //     similarityThreshold,
  //     logLevel,
  //     metadataDir,
  //     debug,
  //     prune,
  //     verifyIntegrity,
  //     multiplex,
  //     facets,
  //   } = options || {};

  //   return {
  //     sourceLocale,
  //     locales,
  //     outputDir,
  //     catalogFormat,
  //     similarityThreshold,
  //     logLevel,
  //     metadataDir,
  //     debug,
  //     prune,
  //     verifyIntegrity,
  //     multiplex,
  //     facets,
  //   };

  return options || {};
}
