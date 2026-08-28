import { ExtractionOptions, ExtractionResult, HtmlProjectionPayload } from "./types.js";
import { ExtractionContext } from "./context.js";
import { generateMessageId } from "./hashing.js";
import { scanTranslatableAttributes } from "./attributes.js";

/**
 * Extracts translatable configuration and template strings from HTML files/templates.
 * Supports: <title>, <meta name="description">, module <script src="...">,
 * HTML text nodes (using stitchHTML), and translatable attributes (alt, placeholder, aria-label, title).
 */
export function extractHtml(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: ExtractionOptions = {},
): ExtractionResult {
  code = code.replace(/\r\n/g, "\n");
  const ctx = new ExtractionContext(code, filePath, fileBoundaryId, options);
  ctx.logger.debug(`Extracting HTML configurations from ${filePath}`);

  const projection: HtmlProjectionPayload = {
    scripts: [],
  };

  // 0. Strip comments to avoid extracting commented out configurations
  const cleanCode = code.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

  // 1. Extract <html dir="...">
  const htmlDirMatch = cleanCode.match(/<html[^>]*dir=["'](ltr|rtl|auto)["']/i);
  if (htmlDirMatch) {
    projection.dir = htmlDirMatch[1].toLowerCase();
  }

  // 2. Extract <title>
  const titleMatch = cleanCode.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    projection.title = titleMatch[1].trim();
  }

  // 2. Extract <meta name="description">
  const descMatch =
    cleanCode.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    cleanCode.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (descMatch) {
    projection.description = descMatch[1].trim();
  }

  // 3. Extract scripts: <script src="...">
  const scriptRegex = /<script[^>]*src=["']([^"']*)["']/gi;
  let match;
  while ((match = scriptRegex.exec(cleanCode)) !== null) {
    projection.scripts.push(match[1]);
  }

  // 4. Extract HTML Text nodes and translatable attributes from the active content block
  let activeContent = code;
  let contentOffset = 0;

  if (options.activeRange) {
    activeContent = code.substring(options.activeRange.start, options.activeRange.end);
    contentOffset = options.activeRange.start;
  } else if (options.isSfcTemplate) {
    activeContent = code;
    contentOffset = 0;
  } else if (filePath.endsWith(".html")) {
    const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(code);
    if (bodyMatch) {
      activeContent = bodyMatch[1];
      contentOffset = code.indexOf(bodyMatch[1], bodyMatch.index);
    } else {
      activeContent = "";
    }
  } else {
    activeContent = code;
    contentOffset = 0;
  }

  if (activeContent.trim()) {
    // Extract HTML Text nodes
    ctx.stitchHTML(
      activeContent,
      (trimmed, note, passVars, start, end, tagMap, hostTag) => {
        let processedText = trimmed;
        const variables: any[] = [];

        if (ctx.mustacheRegex) {
          const regex = ctx.mustacheRegex;
          regex.lastIndex = 0;
          let match;
          let offsetShift = 0;
          let varIndex = 0;

          // Find matches in the original trimmed string
          const matches: { raw: string; expr: string; index: number }[] = [];
          while ((match = regex.exec(trimmed)) !== null) {
            matches.push({
              raw: match[0],
              expr: match[1].trim(),
              index: match.index,
            });
          }

          // Process and replace mustaches with {varName}
          for (const m of matches) {
            let varName = m.expr;
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName)) {
              varName = `var${varIndex++}`;
            }

            const replacement = `{${varName}}`;
            const matchIndexInProcessed = m.index + offsetShift;

            processedText =
              processedText.substring(0, matchIndexInProcessed) +
              replacement +
              processedText.substring(matchIndexInProcessed + m.raw.length);

            offsetShift += replacement.length - m.raw.length;

            variables.push({
              name: varName,
              originalName: varName,
              expression: m.expr,
              start: contentOffset + start! + m.index,
              end: contentOffset + start! + m.index + m.raw.length,
            });
          }
        }

        const stripped = processedText.replace(/\{[a-zA-Z_$][a-zA-Z0-9_$]*\}/g, "").trim();
        if (stripped === "") {
          return;
        }

        const msgId = generateMessageId(processedText, "HTML_TEXT", note);
        /**
         * The element goes in `context`; `sinkType` stays the constant.
         *
         * Two arguments to `addMessage` that used to be the same string and are
         * two different questions (032 §2). `context` is what a translator
         * reads — `h1`, `li`. `sinkType` is how the pipeline splices a call back
         * into the document, and `resolve-rewrites.ts` and the html facet both
         * test it for equality against `"HTML_TEXT"`, so widening it here would
         * be a rewrite of the splice path wearing a metadata change's clothes.
         *
         * Safe because context is never a key: `generateMessageId` ignores the
         * parameter it is passed in (032 §8.1), so an `<h1>` and a `<p>` holding
         * the same words remain one message with two recorded contexts.
         */
        ctx.addMessage(
          msgId,
          processedText,
          hostTag ?? "HTML_TEXT",
          fileBoundaryId,
          { line: 0, column: 0 },
          variables.map((v) => v.name),
          note,
          "HTML_TEXT",
          passVars,
        );

        ctx.addRawSink({
          text: processedText,
          sinkType: "HTML_TEXT",
          context: hostTag,
          start: contentOffset + start!,
          end: contentOffset + end!,
          line: 0,
          column: 0,
          boundaryId: fileBoundaryId,
          variables,
          note,
          passVars,
          isFragment: false,
          tagMap,
        });
      },
      undefined,
      {},
      (s, e) => ({ start: s, end: e }),
    );

    // Extract translatable attributes. Shared with the JavaScript path — see
    // `scanTranslatableAttributes`, which this loop became.
    scanTranslatableAttributes(activeContent, ctx, fileBoundaryId, (i) => contentOffset + i);
  }

  return {
    messages: Array.from(ctx.messages.values()),
    code,
    transforms: ctx.transforms,
    needsLoader: ctx.messages.size > 0 || ctx.usedKeys.size > 0,
    hasZintlMacro: ctx.hasZintlMacro,
    hasZintlMarker: ctx.hasZintlMarker,
    anchorSites: ctx.anchorSites,
    mode: ctx.mode,
    runtimeImports: ctx.runtimeImports,
    dependencies: projection.scripts.map((s) => ({ id: s, dynamic: false })),
    usedKeys: ctx.usedKeys,
    boundaryHashes: ctx.computeBoundaryHashes(),
    exportedBoundaries: Object.fromEntries(ctx.exportedBoundaries),
    internalDeps: Object.fromEntries(
      Array.from(ctx.internalDeps.entries()).map(([k, v]) => [k, Array.from(v)]),
    ),
    rawSinks: ctx.rawSinks,
    rawManualTranslations: ctx.rawManualTranslations,
    htmlProjection: options.isSfcTemplate ? undefined : projection,
  };
}
