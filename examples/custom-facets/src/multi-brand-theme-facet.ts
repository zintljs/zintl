import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZintlFacet } from "@zintl/compiler";

export function multiBrandThemeFacet(): ZintlFacet {
  async function getTranslations(locale: string, context: any) {
    context.logger.info(`MultiBrandThemeFacet loading all brands for locale: ${locale}`);
    const brandFolder = join(context.root, "brand-overrides");
    const catalog: Record<string, string> = {};

    if (existsSync(brandFolder)) {
      try {
        const files = readdirSync(brandFolder);
        for (const file of files) {
          if (file.endsWith(`.${locale}.json`)) {
            const brandName = file.substring(0, file.length - `.${locale}.json`.length);
            const content = readFileSync(join(brandFolder, file), "utf-8");
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
              for (const [k, v] of Object.entries(parsed)) {
                catalog[`${k}:${brandName}`] = String(v);
              }
            }
          }
        }
        context.logger.info(`Loaded brand override keys: ${Object.keys(catalog).join(", ")}`);
      } catch (e) {
        context.logger.error(`Failed to parse brand overrides: ${String(e)}`);
      }
    }

    return catalog;
  }

  return {
    name: "multi-brand-theme-facet",
    concern: "content",
    priority: 30,
    virtualBoundaries: ["b_brand"],
    match(filePath: string, _context: any) {
      // Matches brand configuration files in the brand-overrides folder
      const parts = filePath.replace(/\\/g, "/").split("/");
      return parts.includes("brand-overrides");
    },
    discover(_filePath: string, _context: any) {
      // No-op, discovered dynamically from environment/directory
    },
    getTranslations,
    async getChunkContributions(locale: string, context: any) {
      const catalog = await getTranslations(locale, context);
      return {
        imports: [],
        boundaryId: "b_brand",
        catalog,
      };
    },
    isContentBoundary(boundaryId: string, _context: any) {
      return boundaryId === "b_brand";
    },
    async getBoundaryForLocalizedOutput(filePath: string, _context: any) {
      if (filePath.replace(/\\/g, "/").includes("brand-overrides")) {
        return "b_brand";
      }
      return null;
    },
  };
}
