import { join, relative, dirname } from "node:path";
import type { ZintlFacet, CompilerContext, TargetDescriptor } from "../types.js";
import { IOManager } from "../../managers/IOManager.js";
import type { CatalogManager } from "../../managers/CatalogManager.js";
import type { ZintlLogger, HtmlProjectionPayload } from "@zintl/extractor";
import { sortObjectKeys } from "../../utils/serialization.js";

/**
 * Manages HTML-specific projections, schemas, and disk catalogs.
 * Internal class wrapped by the system html-projection facet.
 */
class HtmlManager {
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
    internalManifest?: Record<string, any[]>,
  ) {
    const isMulti = this.catalog.isMultilingualFormat();
    for (const [id, meta] of Object.entries(htmlMetadatas)) {
      if (!meta.htmlProjection) continue;

      this.logger.debug(`Syncing HTML projections for ${id} (isMulti: ${isMulti})`);

      const schemaPath = this.getSchemaPath(id);
      const boundaryMessages = internalManifest ? internalManifest[id] || [] : [];
      const schema = sortObjectKeys(
        this.generateSchema(meta.htmlProjection, locales, isMulti, boundaryMessages),
      );
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

              if (meta.htmlProjection.title !== undefined && content.title === undefined) {
                content.title = hive[locale]?.[`__zintl:html:${id}:title`] || "";
                changed = true;
              }
              if (
                meta.htmlProjection.description !== undefined &&
                content.description === undefined
              ) {
                content.description = hive[locale]?.[`__zintl:html:${id}:description`] || "";
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

              if (content.title !== undefined && hive[locale][titleKey] !== content.title) {
                hive[locale][titleKey] = content.title;
                hiveChanged = true;
              }
              if (
                content.description !== undefined &&
                hive[locale][descKey] !== content.description
              ) {
                hive[locale][descKey] = content.description;
                hiveChanged = true;
              }
              if (content.dir !== undefined && hive[locale][dirKey] !== content.dir) {
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

  private generateSchema(
    projection: HtmlProjectionPayload,
    locales: string[],
    isMulti: boolean,
    messages: any[] = [],
  ) {
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

    for (const msg of messages) {
      const vars = new Set<string>();
      if (msg.variables) msg.variables.forEach((v: string) => vars.add(v));
      if (msg.passVars) Object.keys(msg.passVars).forEach((v: string) => vars.add(v));

      if (vars.size > 0 || msg.note) {
        const desc: string[] = [];
        if (msg.note) desc.push(`Note: ${msg.note}`);
        if (vars.size > 0) desc.push(`Variables: {${Array.from(vars).join("}, {")}}`);
        properties[msg.text] = wrapLocale({
          anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }],
          description: desc.join(" | "),
        });
      } else {
        properties[msg.text] = wrapLocale({ type: "string" });
      }
    }

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

export interface HtmlExtractionOptions {
  targets?: TargetDescriptor[];
  extensions?: string[];
}

interface HtmlProjectionOptions {
  // Option fields can be added in future
}

export interface HtmlFacetOptions {
  targets?: TargetDescriptor[];
  extensions?: string[];
}

/**
 * HTML extraction contribution.
 * Covers translatable HTML attributes in .html files.
 */
export function htmlExtractionFacet(options: HtmlExtractionOptions = {}): ZintlFacet {
  return {
    name: "html-extraction",
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
      "html:attr:alt",
      "html:attr:title",
      "html:attr:placeholder",
      "html:attr:aria-label",
      "html:attr:aria-description",
      "html:attr:label",
      "html:attr:description",
      "html:attr:tooltip",
      "html:attr:dir",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".html"],
  };
}

function findParentTagStart(html: string, index: number): number {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const char = html[i];
    if (char === ">") {
      let start = i;
      while (start >= 0 && html[start] !== "<") {
        start--;
      }
      if (start >= 0) {
        const tag = html.slice(start, i + 1);
        if (tag.startsWith("</")) {
          depth++;
        } else if (!tag.endsWith("/>") && !tag.startsWith("<!--")) {
          if (depth === 0) {
            return start;
          }
          depth--;
        }
      }
      i = start;
    } else if (char === "<") {
      let end = i;
      while (end < html.length && html[end] !== ">") {
        end++;
      }
      const tag = html.slice(i, end + 1);
      if (!tag.startsWith("</") && !tag.endsWith("/>") && !tag.startsWith("<!--")) {
        if (depth === 0) {
          return i;
        }
      }
    }
  }
  return -1;
}

function injectDataAttribute(tag: string, attrName: string, attrValue: string): string {
  const match = tag.match(/^<([a-zA-Z0-9:-]+)/);
  if (!match) return tag;
  const tagName = match[1];
  const insertPos = 1 + tagName.length;
  return tag.slice(0, insertPos) + ` ${attrName}="${attrValue}"` + tag.slice(insertPos);
}

/**
 * HTML projection content contribution.
 * Manages HTML schema and catalog updates.
 */
export function htmlProjectionFacet(_options: HtmlProjectionOptions = {}): ZintlFacet {
  let manager: HtmlManager;

  const getManager = (context: CompilerContext) => {
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
    concern: "content",
    priority: 100,
    getManagerInstance(context: CompilerContext) {
      return getManager(context);
    },
    match(filePath: string, _context: CompilerContext) {
      return filePath.endsWith(".html");
    },
    async flush(context: CompilerContext) {
      const htmlMetadatas: Record<string, any> = {};
      const metaGraph = context.getMetadataGraph();
      for (const [id, meta] of Object.entries(metaGraph)) {
        if (!meta.htmlProjection) continue;
        const check = context.leadsToBoundary(id, context.getDependencyGraph(), metaGraph);
        if (check.leads) {
          htmlMetadatas[id] = meta;
        }
      }
      await getManager(context).syncHtmlProjections(
        htmlMetadatas,
        context.locales,
        context.getHive(),
        context.markHiveDirty,
        context.internalManifest,
      );
    },
    isContentBoundary(boundaryId: string, context: CompilerContext) {
      const meta = context.getMetadataGraph()[boundaryId];
      return !!(meta && meta.htmlProjection);
    },
    getProtectedCatalogKeys(boundaryId: string, context: CompilerContext) {
      const meta = context.getMetadataGraph()[boundaryId];
      if (meta && meta.htmlProjection) {
        const keys: string[] = ["dir"];
        if (meta.htmlProjection.title !== undefined) keys.push("title");
        if (meta.htmlProjection.description !== undefined) keys.push("description");
        return keys;
      }
      return [];
    },
    async getBoundaryForLocalizedOutput(filePath: string, context: CompilerContext) {
      const mgr = getManager(context);
      const metaGraph = context.getMetadataGraph();
      for (const bId of Object.keys(metaGraph)) {
        if (metaGraph[bId].htmlProjection) {
          for (const locale of context.locales) {
            const catPath = mgr.getCatalogPath(bId, locale);
            if (
              catPath &&
              context.io.getNormalizedId(catPath) === context.io.getNormalizedId(filePath)
            ) {
              return bId;
            }
          }
        }
      }
      return null;
    },
    async transformHtml(
      html: string,
      id: string,
      context: CompilerContext,
      preloads?: Record<string, string[]>,
    ): Promise<string> {
      let fileId = context.io.getNormalizedId(id);
      let fannedLocale: string | undefined;

      // Normalize fanned directory requests (e.g. "en" or "en/") to "en/index.html"
      const dirParts = fileId.split("/");
      if (dirParts.length === 1 && context.locales.includes(dirParts[0])) {
        fileId = `${dirParts[0]}/index.html`;
      } else if (dirParts.length > 1 && context.locales.includes(dirParts[dirParts.length - 1])) {
        fileId = `${fileId}/index.html`;
      }

      const physicalPath = join(context.root, fileId);
      if (await context.io.exists(physicalPath)) {
        const stats = await context.io.stat(physicalPath);
        if (stats.isDirectory()) {
          return html;
        }
      }

      if (fileId.endsWith(".html")) {
        const parts = fileId.split("/");
        for (const loc of context.locales) {
          if (parts.includes(loc) || fileId.includes(`:${loc}`) || fileId.includes(`/${loc}`)) {
            fannedLocale = loc;
            break;
          }
        }
        if (fannedLocale) {
          const filteredParts = parts.filter((p) => p !== fannedLocale);
          fileId = filteredParts.join("/");
        }
      }

      const metaGraph = context.getMetadataGraph();
      let meta = metaGraph[fileId];

      if (!meta || context.isDev) {
        context.logger.debug(`Refreshing HTML metadata: ${fileId}`);
        let sourceHtml = html;
        let sourcePath = id;

        const physicalPath = join(context.root, fileId);
        if (await context.io.exists(physicalPath)) {
          sourceHtml = await context.io.readFile(physicalPath);
          sourcePath = physicalPath;
        }

        await context.transform(sourceHtml, sourcePath, undefined, true);
        meta = context.getMetadataGraph()[fileId];
      }

      if (!meta || !meta.htmlProjection) return html;

      // 1. Identify the "Winning" owner script by tracing the tree
      let winningCheck: { leads: boolean; dynamic: boolean; bakedLocale?: string } | undefined;

      const scripts = meta.htmlProjection.scripts;
      for (const script of scripts) {
        let scriptRel = script;
        if (scriptRel.startsWith("/")) scriptRel = scriptRel.substring(1);
        const scriptPath = join(context.root, scriptRel);
        const scriptId = context.io.getNormalizedId(scriptPath);

        if (!context.getMetadataGraph()[scriptId]) {
          if (await context.io.exists(scriptPath)) {
            context.logger.debug(`JIT extraction for script: ${scriptId}`);
            try {
              const scriptCode = await context.io.readFile(scriptPath);
              await context.transform(scriptCode, scriptPath, undefined, true);
            } catch {}
          }
        }

        const check = context.leadsToBoundary(
          scriptId,
          context.getDependencyGraph(),
          context.getMetadataGraph(),
        );

        if (check.leads) {
          if (!winningCheck || (check.dynamic && !winningCheck.dynamic)) {
            winningCheck = check;
          }
        }
      }

      if (!winningCheck) return html;

      // 2. Determine base projection values
      const isLiteral = !winningCheck.dynamic;
      const targetLocale =
        (isLiteral && fannedLocale) ||
        (isLiteral ? winningCheck.bakedLocale || context.sourceLocale : context.sourceLocale);

      if (targetLocale === "*") {
        const existingRedirectRe = /<script id="zintl-sovereign-redirect">[\s\S]*?<\/script>/gi;
        const cleanedHtml = html.replace(existingRedirectRe, "");

        const localesStr = JSON.stringify(context.locales);
        const defaultLocale = context.sourceLocale || "en";
        const redirectScript = `<script id="zintl-sovereign-redirect">
      (function() {
        const lang = (navigator.language || '${defaultLocale}').split('-')[0];
        const supported = ${localesStr};
        const target = supported.includes(lang) ? lang : '${defaultLocale}';
        window.location.replace('/' + target + '/');
      })();
    </script>`;

        if (cleanedHtml.includes("</head>")) {
          return cleanedHtml.replace(/<\/head>/i, `  ${redirectScript}\n  </head>`);
        }
        return `<head>\n  ${redirectScript}\n</head>\n${cleanedHtml}`;
      }

      let title = meta.htmlProjection.title;
      let description = meta.htmlProjection.description;
      let dir = meta.htmlProjection.dir;
      if (isLiteral && !dir) {
        dir = ["ar", "he", "iw", "fa", "ur", "yi"].includes(targetLocale) ? "rtl" : "ltr";
      }

      const mgr = getManager(context);
      let catalog: any = null;
      if (isLiteral && targetLocale !== "none") {
        const catalogPath = mgr.getCatalogPath(fileId, targetLocale);
        if (await context.io.exists(catalogPath)) {
          try {
            catalog = JSON.parse(await context.io.readFile(catalogPath));
            const catalogTitle = context.catalog.isMultilingualFormat()
              ? catalog.title?.[targetLocale]
              : catalog.title;
            const catalogDesc = context.catalog.isMultilingualFormat()
              ? catalog.description?.[targetLocale]
              : catalog.description;
            const catalogDir = context.catalog.isMultilingualFormat()
              ? catalog.dir?.[targetLocale]
              : catalog.dir;

            title = catalogTitle !== undefined ? catalogTitle : title;
            description = catalogDesc !== undefined ? catalogDesc : description;
            dir = catalogDir !== undefined ? catalogDir : dir;
          } catch {}
        }
      }

      let mutated = html;
      const bodySinks = (meta.sinks || []).filter(
        (s: any) => s.sinkType === "HTML_TEXT" || s.sinkType.startsWith("html:attr:"),
      );

      const deltas: Record<string, any> = {};
      const originals: Record<string, any> = {};

      if (isLiteral) {
        if (catalog) {
          const bodyIdx = mutated.toLowerCase().indexOf("<body");
          let lastSearchIndex = bodyIdx !== -1 ? bodyIdx : 0;

          const sortedSinks = [...bodySinks].sort((a, b) => a.location.start - b.location.start);
          for (const sink of sortedSinks) {
            const translation = context.catalog.isMultilingualFormat()
              ? catalog[sink.text]?.[targetLocale]
              : catalog[sink.text];
            if (translation !== undefined && translation !== "") {
              const type = sink.sinkType === "HTML_TEXT" ? "text" : "attr";
              const attrName = type === "attr" ? sink.sinkType.substring("html:attr:".length) : "";

              let actualStart = -1;
              let actualEnd = -1;
              let replacement = "";

              if (type === "text") {
                actualStart = mutated.indexOf(sink.text, lastSearchIndex);
                if (actualStart !== -1) {
                  actualEnd = actualStart + sink.text.length;
                  replacement = translation;
                }
              } else {
                const searchStr1 = `${attrName}="${sink.text}"`;
                const searchStr2 = `${attrName}='${sink.text}'`;
                actualStart = mutated.indexOf(searchStr1, lastSearchIndex);
                if (actualStart !== -1) {
                  actualEnd = actualStart + searchStr1.length;
                } else {
                  actualStart = mutated.indexOf(searchStr2, lastSearchIndex);
                  if (actualStart !== -1) {
                    actualEnd = actualStart + searchStr2.length;
                  }
                }
                if (actualStart !== -1) {
                  replacement = `${attrName}="${translation}"`;
                }
              }

              if (actualStart !== -1) {
                mutated = mutated.slice(0, actualStart) + replacement + mutated.slice(actualEnd);
                lastSearchIndex = actualStart + replacement.length;
              } else {
                const fallbackStart = sink.location.start;
                const fallbackEnd = sink.location.end;
                const fallbackReplacement =
                  type === "text" ? translation : `${attrName}="${translation}"`;
                mutated =
                  mutated.slice(0, fallbackStart) +
                  fallbackReplacement +
                  mutated.slice(fallbackEnd);
              }
            }
          }
        }
      } else {
        const isMultilingual = context.catalog.isMultilingualFormat();
        let multiCatalog: any;
        if (isMultilingual) {
          const catalogPath = mgr.getCatalogPath(fileId, context.locales[0]);
          if (await context.io.exists(catalogPath)) {
            try {
              multiCatalog = JSON.parse(await context.io.readFile(catalogPath));
            } catch {}
          }
        }

        const localeCatalogs: Record<string, any> = {};
        for (const loc of context.locales) {
          if (loc === context.sourceLocale) continue;
          if (isMultilingual && multiCatalog) {
            localeCatalogs[loc] = multiCatalog;
          } else {
            const catalogPath = mgr.getCatalogPath(fileId, loc);
            if (await context.io.exists(catalogPath)) {
              try {
                localeCatalogs[loc] = JSON.parse(await context.io.readFile(catalogPath));
              } catch {}
            }
          }
        }

        const bodyIdx = mutated.toLowerCase().indexOf("<body");
        let lastSearchIndex = bodyIdx !== -1 ? bodyIdx : 0;

        const sortedSinks = [...bodySinks].sort((a, b) => a.location.start - b.location.start);
        for (let i = 0; i < sortedSinks.length; i++) {
          const sink = sortedSinks[i];
          const id = `z_${i}`;
          const type = sink.sinkType === "HTML_TEXT" ? "text" : "attr";
          const attrName = type === "attr" ? sink.sinkType.substring("html:attr:".length) : "";

          let actualStart = -1;
          if (type === "text") {
            actualStart = mutated.indexOf(sink.text, lastSearchIndex);
          } else {
            const searchStr1 = `${attrName}="${sink.text}"`;
            const searchStr2 = `${attrName}='${sink.text}'`;
            actualStart = mutated.indexOf(searchStr1, lastSearchIndex);
            if (actualStart === -1) {
              actualStart = mutated.indexOf(searchStr2, lastSearchIndex);
            }
            if (actualStart === -1) {
              actualStart = mutated.indexOf(sink.text, lastSearchIndex);
            }
          }

          let tagStart = -1;
          if (actualStart !== -1) {
            if (type === "text") {
              tagStart = findParentTagStart(mutated, actualStart);
            } else {
              let pos = actualStart;
              while (pos >= 0 && mutated[pos] !== "<") {
                pos--;
              }
              tagStart = pos;
            }
            lastSearchIndex = actualStart;
          } else {
            if (type === "text") {
              tagStart = findParentTagStart(mutated, sink.location.start);
            } else {
              let pos = sink.location.start;
              while (pos >= 0 && mutated[pos] !== "<") {
                pos--;
              }
              tagStart = pos;
            }
          }

          if (tagStart !== -1) {
            let tagEnd = tagStart;
            while (tagEnd < mutated.length && mutated[tagEnd] !== ">") {
              tagEnd++;
            }
            if (tagEnd < mutated.length) {
              const originalTag = mutated.slice(tagStart, tagEnd + 1);
              const taggedTag = injectDataAttribute(originalTag, "data-zintl-id", id);
              mutated = mutated.slice(0, tagStart) + taggedTag + mutated.slice(tagEnd + 1);
              if (actualStart !== -1 && tagStart < actualStart) {
                lastSearchIndex += taggedTag.length - originalTag.length;
              }
            }
          }

          originals[id] = { type, name: attrName, val: sink.text };

          for (const loc of context.locales) {
            if (loc === context.sourceLocale) continue;
            const cat = localeCatalogs[loc];
            if (cat) {
              const translation = isMultilingual ? cat[sink.text]?.[loc] : cat[sink.text];
              if (translation !== undefined && translation !== "") {
                if (!deltas[loc]) deltas[loc] = {};
                deltas[loc][id] = { type, name: attrName, val: translation };
              }
            }
          }
        }
      }

      mutated = mutated.replace(/<html([^>]*)>/i, (m, attrs) => {
        let newAttrs = attrs;
        if (!/lang=/i.test(attrs)) newAttrs += ` lang="${targetLocale}"`;
        else newAttrs = newAttrs.replace(/lang=["'][^"']*["']/i, `lang="${targetLocale}"`);

        if (dir) {
          if (!/dir=/i.test(attrs)) newAttrs += ` dir="${dir}"`;
          else newAttrs = newAttrs.replace(/dir=["'][^"']*["']/i, `dir="${dir}"`);
        } else {
          newAttrs = newAttrs.replace(/\s*dir=["'][^"']*["']/i, "");
        }

        return `<html${newAttrs}>`;
      });

      if (title) {
        mutated = mutated.replace(/<title[^>]*>([\s\S]*?)<\/title>/i, `<title>${title}</title>`);
      }
      if (description) {
        mutated = mutated.replace(
          /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
          `<meta name="description" content="${description}">`,
        );
        mutated = mutated.replace(
          /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
          `<meta name="description" content="${description}">`,
        );
      }

      if (!isLiteral) {
        const existingRe =
          /<!--zintl-bootstrap-->\s*<script id="zintl-projection">[\s\S]*?<\/script>/gi;
        mutated = mutated.replace(existingRe, "");

        const rtlLocales: string[] = [];
        const isMultilingual = context.catalog.isMultilingualFormat();
        let multiCatalog: any;
        if (isMultilingual) {
          const catalogPath = mgr.getCatalogPath(fileId, context.locales[0]);
          if (await context.io.exists(catalogPath)) {
            try {
              multiCatalog = JSON.parse(await context.io.readFile(catalogPath));
            } catch {}
          }
        }

        for (const locale of context.locales) {
          const catalogPath = isMultilingual ? "" : mgr.getCatalogPath(fileId, locale);
          if (multiCatalog || (catalogPath && (await context.io.exists(catalogPath)))) {
            try {
              const catalog = multiCatalog || JSON.parse(await context.io.readFile(catalogPath));
              const catalogDir = isMultilingual ? catalog.dir?.[locale] : catalog.dir;
              const catalogTitle = isMultilingual ? catalog.title?.[locale] : catalog.title;
              const catalogDesc = isMultilingual
                ? catalog.description?.[locale]
                : catalog.description;

              if (catalogDir === "rtl") rtlLocales.push(locale);
              else if (locale === context.sourceLocale && dir === "rtl") rtlLocales.push(locale);

              if (locale !== context.sourceLocale) {
                if (title && catalogTitle?.trim() && catalogTitle !== meta.htmlProjection.title) {
                  if (!deltas[locale]) deltas[locale] = {};

                  deltas[locale].title = catalogTitle;
                }
                if (
                  description &&
                  catalogDesc?.trim() &&
                  catalogDesc !== meta.htmlProjection.description
                ) {
                  if (!deltas[locale]) deltas[locale] = {};

                  deltas[locale].description = catalogDesc;
                }
              }
            } catch {}
          } else if (locale === context.sourceLocale && dir === "rtl") {
            rtlLocales.push(locale);
          }
        }

        const hasDeltas = Object.keys(deltas).length > 0;
        const hasPreloads = Object.keys(preloads || {}).length > 0;
        const hasRtl = rtlLocales.length > 0;
        const hasSink = Object.keys(originals).length > 0;

        const rtlChunk = hasRtl ? `const rtl = ${JSON.stringify(rtlLocales)};` : "";
        const deltasChunk = hasDeltas ? `const deltas = ${JSON.stringify(deltas)};` : "";
        const preloadsChunk = hasPreloads
          ? `const preloads = ${JSON.stringify(preloads)};
      function preload(locale) {
        const urls = preloads[locale] || [];
        for (const url of urls) {
          const link = document.createElement("link");
          link.rel = "modulepreload";
          link.href = url;
          document.head.appendChild(link);
        }
      }`
          : "";

        const originalsEnd = JSON.stringify(originals).slice(1);

        let extraObjects = "{\n";
        if (title) {
          extraObjects += `
        title: document.title,`;
        }
        if (description) {
          extraObjects += `
        description: document.querySelector('meta[name="description"]')?.content,`;
        }

        const originalsBase = extraObjects + (hasSink ? originalsEnd + ";" : `\n      };`);

        const originalsChunk =
          title || description || hasSink
            ? `
        const originals = ${originalsBase}`
            : "";

        const applyChunk = hasDeltas
          ? `
          const hasText = v => typeof v === "string" && v.trim();
          const delta = deltas[locale];

          if (delta) {
          ${
            title
              ? `
            document.title = hasText(delta.title)
              ? delta.title
              : originals.title;`
              : ""
          }

          ${
            description
              ? `
            const meta = document.querySelector('meta[name="description"]');
            if (meta && originals.description !== undefined) {
              meta.content = hasText(delta.description)
                ? delta.description
                : originals.description;
            }`
              : ""
          }
          } else {
            ${title ? "document.title = originals.title;" : ""}
            ${
              description
                ? `const meta = document.querySelector('meta[name="description"]');
          if (meta && originals.description !== undefined) meta.content = originals.description;`
                : ""
            }
          }

          ${
            hasSink
              ? `for (const [id, original] of Object.entries(originals)) {
            const el = document.querySelector(\`[data-zintl-id="\${id}"]\`);
            if (!el) continue;
          
            const target = delta && delta[id] ? delta[id] : original;
            if (target.type === "text") {
              el.textContent = hasText(target.val) ? target.val : original.val;
            } else if (target.type === "attr") {
              if (hasText(target.val)) {
                el.setAttribute(target.name, target.val);
              } else {
                el.removeAttribute(target.name);
              }
            }
          }`
              : ""
          }`
          : "";

        const dirChunk = hasRtl
          ? `document.documentElement.dir = rtl.includes(locale) ? 'rtl' : 'ltr';`
          : "";

        const bootstrap = `<!--zintl-bootstrap-->
    <script id="zintl-projection">
      (function() {
        const l = localStorage.getItem('zintl-locale') || '${context.sourceLocale}';
        ${rtlChunk}
        ${deltasChunk}
        ${originalsChunk}
        ${preloadsChunk}

        function apply(locale) {
          if (document.documentElement.lang === locale) return;

          ${dirChunk}
          document.documentElement.lang = locale;

          ${applyChunk}
        }

        window.__zintlApplyHtml = apply;

        if (l !== '${context.sourceLocale}') {
          apply(l);
          ${hasPreloads ? "preload(l);" : ""}
        }
      })();
    </script>`
          .replace(/\n\s*\n+/g, "\n")
          .trim();

        const scriptRe = /<script\s+[^>]*type="module"[^>]*src="\/"[^>]*>\s*<\/script>/i;
        const match = mutated.match(scriptRe);
        if (match) {
          mutated = mutated.replace(match[0], bootstrap + "\n    " + match[0]);
        } else {
          mutated = mutated.replace(/<\/head>/i, `${bootstrap}\n  </head>`);
        }
      }

      return mutated;
    },
  };
}

export function htmlFacet(options: HtmlFacetOptions = {}): ZintlFacet[] {
  return [htmlExtractionFacet(options), htmlProjectionFacet(options)];
}
