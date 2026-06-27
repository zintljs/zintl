import { join, relative, dirname } from "node:path";
import type { ZintlAdapter, CompilerContext } from "../types.js";
import { registerPreset } from "../resolve.js";
import { IOManager } from "../../managers/IOManager.js";
import type { CatalogManager } from "../../managers/CatalogManager.js";
import type { ZintlLogger, HtmlProjectionPayload } from "@zintl/extractor";
import { sortObjectKeys } from "../../utils/serialization.js";

/**
 * Manages HTML-specific projections, schemas, and disk catalogs.
 * Internal class wrapped by the system html-projection adapter.
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

      const schemaPath = this.getSchemaPath(id);
      const schema = sortObjectKeys(this.generateSchema(meta.htmlProjection, locales, isMulti));
      await this.io.safeWriteFile(schemaPath, JSON.stringify(schema, null, 2));

      if (isMulti) {
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

            initialContent.dir = hive[locale]?.[`__zintl:html:${id}:dir`] || "";

            const sorted = sortObjectKeys(initialContent);
            const final = { $schema: sorted.$schema, ...sorted };
            await this.io.safeWriteFile(catalogPath, JSON.stringify(final, null, 2));
          } else {
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

              if (changed) {
                const sorted = sortObjectKeys(content);
                const updated = { $schema: sorted.$schema, ...sorted };
                await this.io.safeWriteFile(catalogPath, JSON.stringify(updated, null, 2));
              }

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

// ── HTML Extraction Adapter ───────────────────────────────────────────────────

/**
 * HTML extraction adapter.
 * Covers translatable HTML attributes in .html files.
 */
const htmlExtractionAdapter: ZintlAdapter = {
  name: "html-extraction",
  extraction: {
    targets: [
      "html:attr:alt",
      "html:attr:title",
      "html:attr:placeholder",
      "html:attr:aria-label",
      "html:attr:aria-description",
      "html:attr:label",
      "html:attr:description",
      "html:attr:tooltip",
      "html:attr:dir",
    ],
    extensions: [".html"],
  },
};

/**
 * HTML projection content adapter.
 * Manages HTML schema and catalog updates.
 */
export function createHtmlProjectionAdapter(): ZintlAdapter {
  let manager: HtmlManager;

  const getManager = (context: CompilerContext) => {
    if ((context as any).htmlManager) {
      return (context as any).htmlManager;
    }
    if (!manager) {
      manager = new HtmlManager(
        context.io,
        context.root,
        context.outputDir,
        context.sourceLocale,
        context.logger,
        context.catalog,
      );
    }
    return manager;
  };

  return {
    name: "system-html-projection",
    content: {
      match(filePath: string, _context: CompilerContext) {
        return filePath.endsWith(".html");
      },
      async flush(context: CompilerContext) {
        const htmlMetadatas = context.getHtmlProjections();
        await getManager(context).syncHtmlProjections(
          htmlMetadatas,
          context.locales,
          context.getHive(),
          context.markHiveDirty,
        );
      },
    },
  };
}

registerPreset("html", () => [htmlExtractionAdapter, createHtmlProjectionAdapter()]);

export { htmlExtractionAdapter };
