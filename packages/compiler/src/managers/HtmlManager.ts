import { join, relative, dirname } from "node:path";
import { IOManager } from "./IOManager.js";
import type { ZintlLogger, HtmlProjectionPayload } from "../types/index.js";
import { sortObjectKeys } from "../utils/serialization.js";

import type { CatalogManager } from "./CatalogManager.js";

/**
 * Manages HTML-specific projections, schemas, and disk catalogs.
 */
export class HtmlManager {
  constructor(
    private readonly io: IOManager,
    private readonly root: string,
    private readonly outputDir: string,
    private readonly sourceLocale: string,
    private readonly logger: ZintlLogger,
    private readonly catalog: CatalogManager,
  ) {}

  /**
   * Generates disk projections and schemas for HTML files.
   */
  public async syncHtmlProjections(
    htmlMetadatas: Record<string, { htmlProjection: HtmlProjectionPayload }>,
    locales: string[],
    hive: Record<string, Record<string, any>>,
    onHiveChange: () => void,
  ) {
    const isMulti = this.catalog.isMultilingualFormat();

    for (const [id, meta] of Object.entries(htmlMetadatas)) {
      if (!meta.htmlProjection) continue;

      this.logger.debug(`Syncing HTML projections for ${id} (isMulti: ${isMulti})`);

      // 1. Generate Schema
      const schemaPath = this.getSchemaPath(id);
      const schema = sortObjectKeys(this.generateSchema(meta.htmlProjection, locales, isMulti));
      await this.io.safeWriteFile(schemaPath, JSON.stringify(schema, null, 2));

      // 2. Generate Catalogs
      if (isMulti) {
        // Multilingual mode: one file for all locales
        const catalogPath = this.getCatalogPath(id, locales[0]);
        const exists = await this.io.exists(catalogPath);
        const schemaRelative = relative(dirname(catalogPath), schemaPath);

        let content: any = {};
        if (exists) {
          try {
            content = JSON.parse(await this.io.readFile(catalogPath));
          } catch {
            content = {};
          }
        }

        let changed = false;
        if (content.$schema !== schemaRelative) {
          content.$schema = schemaRelative;
          changed = true;
        }

        for (const locale of locales) {
          if (locale === this.sourceLocale) continue;

          const fields = ["title", "description", "dir"] as const;
          for (const field of fields) {
            const hiveKey = `__zintl:html:${id}:${field}`;

            if (field === "dir" || meta.htmlProjection[field] !== undefined) {
              if (content[field] === undefined) content[field] = {};
              // Support legacy flat format migration
              if (typeof content[field] === "string") {
                content[field] = { [this.sourceLocale]: content[field] };
              }

              const currentVal = content[field][locale];
              const hiveVal = hive[locale]?.[hiveKey];
              const finalVal = currentVal || hiveVal || (field === "dir" ? "" : "");

              if (currentVal !== finalVal) {
                content[field][locale] = finalVal;
                changed = true;
              }

              // Harvest to Hive
              if (finalVal) {
                if (!hive[locale]) hive[locale] = {};
                if (hive[locale][hiveKey] !== finalVal) {
                  hive[locale][hiveKey] = finalVal;
                  onHiveChange();
                }
              }
            } else if (content[field] !== undefined) {
              delete content[field];
              changed = true;
            }
          }
        }

        if (changed) {
          const sorted = sortObjectKeys(content);
          const updated = { $schema: sorted.$schema, ...sorted };
          await this.io.safeWriteFile(catalogPath, JSON.stringify(updated, null, 2));
        }
      } else {
        // Single-locale mode: one file per locale
        for (const locale of locales) {
          if (locale === this.sourceLocale) continue;

          const catalogPath = this.getCatalogPath(id, locale);
          const exists = await this.io.exists(catalogPath);
          const schemaRelative = relative(dirname(catalogPath), schemaPath);

          if (!exists) {
            const initialContent: any = {
              $schema: schemaRelative,
            };

            if (meta.htmlProjection.title !== undefined) {
              initialContent.title = hive[locale]?.[`__zintl:html:${id}:title`] || "";
            }
            if (meta.htmlProjection.description !== undefined) {
              initialContent.description = hive[locale]?.[`__zintl:html:${id}:description`] || "";
            }

            // dir is ALWAYS included
            initialContent.dir = hive[locale]?.[`__zintl:html:${id}:dir`] || "";

            const sorted = sortObjectKeys(initialContent);
            const final = { $schema: sorted.$schema, ...sorted };
            await this.io.safeWriteFile(catalogPath, JSON.stringify(final, null, 2));
          } else {
            // If exists, ensure $schema is at top and potentially update default values if they are placeholders
            try {
              const raw = await this.io.readFile(catalogPath);
              const content = JSON.parse(raw);
              let changed = false;

              if (content.$schema !== schemaRelative) {
                content.$schema = schemaRelative;
                changed = true;
              }

              if (content.dir === undefined) {
                content.dir = meta.htmlProjection.dir || "";
                changed = true;
              }

              // Prune keys that are not in the projection anymore
              if (meta.htmlProjection.title === undefined && content.title !== undefined) {
                delete content.title;
                changed = true;
              }
              if (
                meta.htmlProjection.description === undefined &&
                content.description !== undefined
              ) {
                delete content.description;
                changed = true;
              }
              // dir is NEVER pruned

              if (changed) {
                // Ensure $schema is first key for DX
                const sorted = sortObjectKeys(content);
                const updated = { $schema: sorted.$schema, ...sorted };
                await this.io.safeWriteFile(catalogPath, JSON.stringify(updated, null, 2));
              }

              // Harvest to Hive
              if (!hive[locale]) hive[locale] = {};
              let hiveChanged = false;

              const titleKey = `__zintl:html:${id}:title`;
              const descKey = `__zintl:html:${id}:description`;
              const dirKey = `__zintl:html:${id}:dir`;

              if (content.title && hive[locale][titleKey] !== content.title) {
                hive[locale][titleKey] = content.title;
                hiveChanged = true;
              }
              if (content.description && hive[locale][descKey] !== content.description) {
                hive[locale][descKey] = content.description;
                hiveChanged = true;
              }
              if (content.dir && hive[locale][dirKey] !== content.dir) {
                hive[locale][dirKey] = content.dir;
                hiveChanged = true;
              }

              if (hiveChanged) {
                onHiveChange();
              }
            } catch (e) {
              this.logger.error(
                `Failed to read/update HTML catalog at ${catalogPath}: ${String(e)}`,
              );
            }
          }
        }
      }
    }
  }

  public getCatalogPath(id: string, locale: string): string {
    return this.catalog.getCatalogPath(id, locale)!;
  }

  public getSchemaPath(id: string): string {
    return join(this.root, this.outputDir, ".schemas", `${id}.schema.json`);
  }

  private generateSchema(projection: HtmlProjectionPayload, locales: string[], isMulti: boolean) {
    const properties: any = {
      $schema: { type: "string" },
    };

    const wrapLocale = (prop: any) => {
      if (!isMulti) return prop;
      const localeProps: any = {};
      for (const l of locales) {
        if (l === this.sourceLocale) continue;
        localeProps[l] = prop;
      }
      return {
        type: "object",
        properties: localeProps,
        additionalProperties: false,
      };
    };

    if (projection.title !== undefined) {
      properties.title = wrapLocale({
        type: "string",
        description: `Original: ${projection.title || "(none)"}`,
      });
    }
    if (projection.description !== undefined) {
      properties.description = wrapLocale({
        type: "string",
        description: `Original: ${projection.description || "(none)"}`,
      });
    }

    // dir is ALWAYS included in schema
    properties.dir = wrapLocale({
      type: "string",
      enum: ["ltr", "rtl", "auto", ""],
      default: "",
    });

    const schema: any = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties,
      required: isMulti ? undefined : ["dir"],
      additionalProperties: false,
    };

    return schema;
  }
}
