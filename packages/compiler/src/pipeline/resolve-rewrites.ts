import type {
  TransformIntent,
  ResolvedRewrite,
  Diagnostic,
  AnchorRewriteIntent,
  SinkWrapIntent,
  ManualTRewriteIntent,
  BakingIntent,
  VariableBinding,
  ZintlConfig,
} from "../types/index.js";
import type { CodegenAdapter } from "../adapter/types.js";

/**
 * Find the codegen adapter for a given file path.
 * Uses the resolved adapter hooks — never the old TargetAdapter array.
 */
function findCodegen(
  filePath: string | undefined,
  config: ZintlConfig,
): CodegenAdapter | undefined {
  if (!filePath) return undefined;
  if (config.hooks?.codegenAdapters) {
    const found = config.hooks.codegenAdapters.find((a) => a.match(filePath));
    if (found) return found;
  }
  if (config.adapters) {
    const foundLegacy = (config.adapters as any[]).find(
      (a) => typeof a.match === "function" && a.match(filePath),
    );
    if (foundLegacy) {
      const isSfc = !!foundLegacy.sfc;
      return {
        extensions: [],
        match: foundLegacy.match,
        wrapHtmlText: foundLegacy.wrapHtmlText,
        wrapHtmlAttribute: foundLegacy.wrapHtmlAttribute,
        wrapSfcScript: foundLegacy.wrapSfcScript,
        wrapJsxRichText: foundLegacy.jsx
          ? (r) =>
              `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${r} }} />`
          : undefined,
        quoteLiteral: isSfc
          ? (s: string) => {
              const escaped = s
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\{/g, "\\x7b")
                .replace(/\}/g, "\\x7d");
              return "'" + escaped + "'";
            }
          : undefined,
      };
    }
  }
  return undefined;
}

const PRIORITY = {
  bake: 100,
  sink_wrap: 80,
  manual_t: 70,
  anchor: 50,
  quote_convert: 10,
};

const translatableAttrs = new Set([
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "label",
  "description",
  "tooltip",
]);

/** Default tag serialization when no codegen adapter provides serializeTags. */
function defaultSerializeTags(tags: any[]): string {
  return JSON.stringify(tags);
}

/** Default convertToHtmlTemplate when no codegen adapter provides one. */
function defaultConvertToHtmlTemplate(tagOpen: string): string {
  return tagOpen;
}

/**
 * Resolve rewrite intents into ordered operations.
 */
export function resolveRewrites(
  intents: TransformIntent[],
  config: ZintlConfig,
  filePath?: string,
): ResolvedRewrite[] {
  const rewrites: ResolvedRewrite[] = [];

  for (const intent of intents) {
    switch (intent.type) {
      case "anchor_rewrite":
        rewrites.push(generateAnchorRewrite(intent, config));
        break;
      case "sink_wrap":
        rewrites.push(generateSinkWrapRewrite(intent, config, filePath));
        break;
      case "manual_t_rewrite":
        rewrites.push(generateManualTRewrite(intent));
        break;
      case "baking":
        rewrites.push(generateBakeRewrite(intent, config, filePath));
        break;
      case "marker_removal":
        rewrites.push({
          start: intent.start,
          end: intent.end,
          replacement: intent.replacement,
          kind: "passthrough",
          priority: PRIORITY.bake,
        });
        break;
      case "source_locale_passthrough": {
        let replacement = intent.sink.text;
        const varMap = new Map<string, string>();
        for (const v of intent.sink.variables) {
          const expr = v.expression || (v as any).expr || "";
          const replacementStr = "${" + expr + "}";
          if (v.name) varMap.set(v.name, replacementStr);
          if (v.originalName) varMap.set(v.originalName, replacementStr);
        }

        if (replacement.includes("{")) {
          replacement = replacement.replace(
            /\{([^}]+)\}/g,
            (match, key) => varMap.get(key.trim()) || match,
          );
        }

        const adapter = findCodegen(filePath, config);
        const isJsxRichText = !!adapter?.wrapJsxRichText;
        const convertFn = adapter?.convertToHtmlTemplate ?? defaultConvertToHtmlTemplate;

        if (intent.sink.tagMap && intent.sink.tagMap.length) {
          replacement = reconstructTags(
            replacement,
            intent.sink.tagMap,
            isJsxRichText ? convertFn : undefined,
          );
        }

        let finalReplacement = replacement;
        if (!intent.sink.isFragment) {
          finalReplacement =
            intent.sink.sinkType === "TemplateLiteral" ||
            intent.sink.sinkType === "HTML" ||
            (intent.sink.variables && intent.sink.variables.length > 0) ||
            (intent.sink.tagMap && intent.sink.tagMap.length > 0)
              ? "`" + replacement + "`"
              : JSON.stringify(replacement);
        }

        if (
          !finalReplacement ||
          finalReplacement === '""' ||
          finalReplacement === "''" ||
          finalReplacement === "``"
        ) {
          if (intent.sink.text) {
            finalReplacement =
              intent.sink.sinkType === "StringLiteral"
                ? JSON.stringify(intent.sink.text)
                : "`" + intent.sink.text + "`";
          }
        }

        const tMap = intent.sink.tagMap || [];
        const hasTags = hasUsedTags(replacement, tMap) || hasUsedTags(intent.sink.text, tMap);
        const isJsxRichTextPassthrough =
          isJsxRichText &&
          intent.sink.requiresJsxBraces &&
          hasTags &&
          !translatableAttrs.has(intent.sink.sinkType);

        if (isJsxRichTextPassthrough) {
          finalReplacement = adapter!.wrapJsxRichText!(finalReplacement);
          finalReplacement = `{${finalReplacement}}`;
        } else if (intent.sink.sinkType === "HTML_TEXT") {
          const hasVars = intent.sink.variables && intent.sink.variables.length > 0;
          if (hasVars) {
            if (adapter && adapter.wrapHtmlText) {
              finalReplacement = adapter.wrapHtmlText(finalReplacement, hasTags, hasVars);
            }
          } else {
            finalReplacement = replacement;
          }
        } else if (intent.sink.sinkType && intent.sink.sinkType.startsWith("html:attr:")) {
          const attrName = intent.sink.sinkType.substring("html:attr:".length);
          const hasVars = intent.sink.variables && intent.sink.variables.length > 0;
          if (hasVars) {
            if (adapter && adapter.wrapHtmlAttribute) {
              finalReplacement = adapter.wrapHtmlAttribute(attrName, finalReplacement, hasVars);
            }
          } else {
            let rawVal = replacement;
            if (rawVal.startsWith('"') && rawVal.endsWith('"')) rawVal = JSON.parse(rawVal);
            else if (rawVal.startsWith("'") && rawVal.endsWith("'")) rawVal = rawVal.slice(1, -1);
            else if (rawVal.startsWith("`") && rawVal.endsWith("`")) rawVal = rawVal.slice(1, -1);
            finalReplacement = `${attrName}="${rawVal.replace(/"/g, "&quot;")}"`;
          }
        } else if (intent.sink.requiresJsxBraces) {
          const isPlainString =
            (finalReplacement.startsWith('"') && finalReplacement.endsWith('"')) ||
            (finalReplacement.startsWith("'") && finalReplacement.endsWith("'"));
          const isAttribute = translatableAttrs.has(intent.sink.sinkType);

          if (isPlainString) {
            if (isAttribute) {
              // Keep it as a plain quoted string literal
            } else {
              // For JSXText/children, we want the raw unquoted text
              finalReplacement = finalReplacement.slice(1, -1);
            }
          } else {
            finalReplacement = `{${finalReplacement}}`;
          }
        }

        rewrites.push({
          start: intent.sink.location.start,
          end: intent.sink.location.end,
          replacement: finalReplacement || '""',
          kind: "passthrough",
          priority: PRIORITY.bake,
        });
        break;
      }
    }
  }

  return rewrites;
}

/**
 * Resolve overlapping conflicts using priority rules.
 */
export function resolveConflicts(
  rewrites: ResolvedRewrite[],
  diagnostics: Diagnostic[],
): ResolvedRewrite[] {
  const sorted = [...rewrites].sort((a, b) => a.start - b.start || b.priority - a.priority);
  const result: ResolvedRewrite[] = [];
  let currentEnd = -1;

  for (const rewrite of sorted) {
    if (rewrite.start >= currentEnd) {
      result.push(rewrite);
      currentEnd = rewrite.end;
    } else {
      const last = result[result.length - 1];

      // Merge if identical range and same priority
      if (
        rewrite.start === last.start &&
        rewrite.end === last.end &&
        rewrite.priority === last.priority
      ) {
        diagnostics.push({
          severity: "info",
          message: `Merging duplicate rewrite at ${rewrite.start}:${rewrite.end}`,
        });
        // In a real system we might want a formal merge() method, but for now we'll just keep the first
        // since planAnchors already merged the loaders at the intent level.
        continue;
      }

      if (rewrite.priority > last.priority) {
        result.pop();
        result.push(rewrite);
        currentEnd = rewrite.end;
        diagnostics.push({
          severity: "warn",
          message: `Overlap at ${rewrite.start}:${rewrite.end}. Lower priority dropped.`,
          location: { start: last.start, end: last.end, line: 0, column: 0 },
        });
      } else {
        diagnostics.push({
          severity: "info",
          message: `Redundant rewrite suppressed at ${rewrite.start}:${rewrite.end}`,
        });
      }
    }
  }

  if (diagnostics.some((d) => d.message.includes("main"))) {
    // This might not work if diagnostics don't have file info.
  }
  // Just log everything for now if it's dist build.
  return result;
}

function generateAnchorRewrite(intent: AnchorRewriteIntent, config: ZintlConfig): ResolvedRewrite {
  let loadersObj = intent.loaders
    .map((l) => `[${JSON.stringify(l.boundaryId)}]: _zintl_mgr_${l.safeId}.loader`)
    .join(", ");
  let localePart = "";

  if (intent.locale) {
    if (intent.locale.type === "literal") {
      localePart = `locale: "${intent.locale.value}", `;
    } else if (intent.locale.type === "expression" && intent.locale.source) {
      const src = intent.locale.source.trim();
      if (src.startsWith("{") && src.endsWith("}")) {
        const inner = src.substring(1, src.length - 1).trim();
        localePart = inner + (inner.endsWith(",") ? " " : ", ");
      } else {
        localePart = `locale: ${src}, `;
      }
    }
  }

  let debugPart = "";
  if (config.debug) {
    debugPart = `debug: ${config.debug === true ? "true" : JSON.stringify(config.debug)}, `;
  }

  return {
    start: intent.location.start,
    end: intent.location.end,
    replacement: `(globalThis.__zintl_inst = loadI18nInstance({ ${localePart}${debugPart}loaders: { ${loadersObj} } }))`,
    kind: "anchor",
    priority: PRIORITY.anchor,
  };
}

function jsString(str: string, escapeCurly = false): string {
  let escaped = str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (escapeCurly) {
    escaped = escaped.replace(/\{/g, "\\x7b").replace(/\}/g, "\\x7d");
  }
  return "'" + escaped + "'";
}

function hasUsedTags(text: string, tagMap?: any[]): boolean {
  if (!text || !tagMap || !tagMap.length) return false;
  return tagMap.some(
    (entry: any) =>
      text.includes(`<${entry.alias}`) ||
      text.includes(`</${entry.alias}`) ||
      text.includes(`<${entry.tagName}`) ||
      text.includes(`</${entry.tagName}`),
  );
}

function generateSinkWrapRewrite(
  intent: SinkWrapIntent,
  config: ZintlConfig,
  filePath?: string,
): ResolvedRewrite {
  const params = intent.variables || [];
  const paramsObj =
    params.length > 0 ? `, { ${params.map((p) => `${p.name}: ${p.expr}`).join(", ")} }` : "";
  const mgrRef = `_zintl_mgr_${intent.safeId}`;
  const keyIdentifier =
    intent.isDev && intent.sink.text ? intent.sink.text : intent.messageId || intent.sink.text;

  let tagsPart = "";
  const adapter = findCodegen(filePath, config);
  const isSfc = !!adapter?.wrapSfcScript;
  const quoteFn = adapter?.quoteLiteral ?? JSON.stringify;

  const tMap = intent.sink.tagMap || [];
  const hasTags = hasUsedTags(intent.sink.text, tMap);

  const isJsxRichText = !!adapter?.wrapJsxRichText;

  if (intent.sink.text && hasTags) {
    const usedTags = tMap.filter(
      (entry: any) =>
        intent.sink.text.includes(`<${entry.alias}>`) ||
        intent.sink.text.includes(`</${entry.alias}>`) ||
        intent.sink.text.includes(`<${entry.alias}/>`) ||
        intent.sink.text.includes(`<${entry.alias} />`),
    );
    if (usedTags.length > 0) {
      const serializeFn = adapter?.serializeTags ?? defaultSerializeTags;
      const tagsStr = isSfc
        ? `JSON.parse(${jsString(JSON.stringify(usedTags), true)})`
        : serializeFn(usedTags);
      tagsPart = `, _tags: ${tagsStr}`;
    }
  }

  let replacement = `_t(${quoteFn(keyIdentifier)}${paramsObj}, { _mgr: ${mgrRef}, _bId: ${quoteFn(intent.boundaryId)}${tagsPart} })`;
  if (intent.sink.isFragment) replacement = `\${${replacement}}`;

  // Custom HTML_TEXT and html:attr: wrapping for Vue / Svelte template syntax
  if (intent.sink.sinkType === "HTML_TEXT") {
    if (adapter && adapter.wrapHtmlText) {
      replacement = adapter.wrapHtmlText(replacement, hasTags, true);
    }
  } else if (intent.sink.sinkType && intent.sink.sinkType.startsWith("html:attr:")) {
    const attrName = intent.sink.sinkType.substring("html:attr:".length);
    if (adapter && adapter.wrapHtmlAttribute) {
      replacement = adapter.wrapHtmlAttribute(attrName, replacement, true);
    }
  }
  const isJsxRichTextSink =
    isJsxRichText &&
    intent.sink.requiresJsxBraces &&
    hasTags &&
    !translatableAttrs.has(intent.sink.sinkType);

  if (isJsxRichTextSink) {
    replacement = adapter!.wrapJsxRichText!(replacement);
  }

  if (intent.sink.requiresJsxBraces) {
    replacement = `{${replacement}}`;
  }

  return {
    start: intent.sink.location.start,
    end: intent.sink.location.end,
    replacement,
    kind: "sink_wrap",
    priority: PRIORITY.sink_wrap,
  };
}

function generateManualTRewrite(intent: ManualTRewriteIntent): ResolvedRewrite {
  const mgrRef = `_zintl_mgr_${intent.safeId}`;
  const keyIdentifier = intent.isDev ? intent.originalKey : intent.messageId || intent.originalKey;
  const replacement = `_t(${JSON.stringify(keyIdentifier)}${intent.paramsSource ? ", " + intent.paramsSource : ""}, { _mgr: ${mgrRef}, _bId: ${JSON.stringify(intent.boundaryId)} })`;

  return {
    start: intent.location.start,
    end: intent.location.end,
    replacement,
    kind: "manual_t",
    priority: PRIORITY.manual_t,
  };
}

function reconstructTags(
  text: string,
  tagMap: any[],
  convertFn?: (tagOpen: string) => string,
): string {
  let result = text;
  for (const entry of tagMap) {
    let open = entry.originalOpen;
    if (convertFn) {
      open = convertFn(open);
    }
    result = result.replaceAll(`<${entry.alias}/>`, open);
    result = result.replaceAll(`<${entry.alias} />`, open);
    result = result.replaceAll(`<${entry.alias}>`, open);
    result = result.replaceAll(`</${entry.alias}>`, `</${entry.tagName}>`);
  }
  return result;
}

function generateBakeRewrite(
  intent: BakingIntent,
  config: ZintlConfig,
  filePath?: string,
): ResolvedRewrite {
  const adapter = findCodegen(filePath, config);
  const isJsxRichText = !!adapter?.wrapJsxRichText;
  const convertFn = adapter?.convertToHtmlTemplate ?? defaultConvertToHtmlTemplate;
  let baked = bakeTranslation(
    intent.translation,
    intent.variables || [],
    intent.sink.isFragment,
    intent.tagMap,
    isJsxRichText ? convertFn : undefined,
  );
  const tMap = intent.tagMap || intent.sink.tagMap || [];
  const hasTags = hasUsedTags(baked, tMap) || hasUsedTags(intent.sink.text, tMap);

  if (
    !intent.sink.isFragment &&
    (intent.sink.sinkType === "TemplateLiteral" || intent.sink.sinkType === "HTML" || hasTags) &&
    !baked.startsWith("`")
  ) {
    baked = "`" + (baked.startsWith('"') ? JSON.parse(baked) : baked) + "`";
  }

  // Custom HTML_TEXT and html:attr: baking for Vue / Svelte template syntax
  if (intent.sink.sinkType === "HTML_TEXT") {
    const hasVars = intent.variables && intent.variables.length > 0;
    if (hasVars) {
      if (adapter && adapter.wrapHtmlText) {
        baked = adapter.wrapHtmlText(baked, hasTags, hasVars);
      }
    } else {
      baked = typeof intent.translation === "string" ? intent.translation : baked;
      if (baked.startsWith('"') && baked.endsWith('"')) {
        baked = JSON.parse(baked);
      } else if (baked.startsWith("'") && baked.endsWith("'")) {
        baked = baked.slice(1, -1);
      } else if (baked.startsWith("`") && baked.endsWith("`")) {
        baked = baked.slice(1, -1);
      }
    }
  } else if (intent.sink.sinkType && intent.sink.sinkType.startsWith("html:attr:")) {
    const attrName = intent.sink.sinkType.substring("html:attr:".length);
    const hasVars = intent.variables && intent.variables.length > 0;
    if (hasVars) {
      if (adapter && adapter.wrapHtmlAttribute) {
        baked = adapter.wrapHtmlAttribute(attrName, baked, hasVars);
      }
    } else {
      let rawVal = typeof intent.translation === "string" ? intent.translation : baked;
      if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
        rawVal = JSON.parse(rawVal);
      } else if (rawVal.startsWith("'") && rawVal.endsWith("'")) {
        rawVal = rawVal.slice(1, -1);
      } else if (rawVal.startsWith("`") && rawVal.endsWith("`")) {
        rawVal = rawVal.slice(1, -1);
      }
      baked = `${attrName}="${rawVal.replace(/"/g, "&quot;")}"`;
    }
  }
  const isJsxRichTextBake =
    isJsxRichText &&
    intent.sink.requiresJsxBraces &&
    hasTags &&
    !translatableAttrs.has(intent.sink.sinkType);

  if (isJsxRichTextBake) {
    baked = adapter!.wrapJsxRichText!(baked);
  }

  if (intent.sink.requiresJsxBraces) {
    const isPlainString =
      (baked.startsWith('"') && baked.endsWith('"')) ||
      (baked.startsWith("'") && baked.endsWith("'"));
    const isAttribute = translatableAttrs.has(intent.sink.sinkType);

    if (isPlainString) {
      if (isAttribute) {
        // Keep it as a plain quoted string literal (e.g. alt="translated text")
      } else {
        // For JSXText/children, we want the raw unquoted text (e.g. <h1>translated text</h1>)
        baked = baked.slice(1, -1);
      }
    } else {
      // If it is a template literal or ternary expression, it MUST be wrapped in curly braces
      baked = `{${baked}}`;
    }
  }

  return {
    start: intent.sink.location.start,
    end: intent.sink.location.end,
    replacement: baked,
    kind: "bake",
    priority: PRIORITY.bake,
  };
}

function bakeTranslation(
  translation: string | Record<string, string>,
  variables: VariableBinding[],
  isFragment: boolean = false,
  tagMap?: any[],
  convertFn?: (tagOpen: string) => string,
): string {
  if (typeof translation === "string") {
    let replaced = translation;
    if (translation.includes("{")) {
      const varMap = new Map<string, string>();
      for (const v of variables) {
        const expr = v.expr || "";
        const replacementStr =
          expr.includes(".") || expr.includes("[") ? `\${${expr}}` : `\${${v.name}}`;
        if (v.name) varMap.set(v.name, replacementStr);
        if (expr) varMap.set(expr, replacementStr);
      }
      replaced = translation.replace(
        /\{([^}]+)\}/g,
        (match, key) => varMap.get(key.trim()) || match,
      );
    }
    if (tagMap && tagMap.length) {
      replaced = reconstructTags(replaced, tagMap, convertFn);
    }
    return isFragment
      ? replaced
      : translation.includes("{") || (tagMap && tagMap.length)
        ? "`" + replaced + "`"
        : JSON.stringify(replaced);
  }
  return typeof translation === "object"
    ? buildTernary(Object.entries(translation), variables, 0, tagMap, convertFn)
    : '""';
}

function buildTernary(
  entries: [string, string | Record<string, string>][],
  variables: VariableBinding[],
  index: number,
  tagMap?: any[],
  convertFn?: (tagOpen: string) => string,
): string {
  if (index >= entries.length) return '""';
  const [condition, text] = entries[index];
  const jsCondition = parseConditionToJS(condition, variables);

  const mentionedInConds = new Set<string>();
  for (const [cond] of entries) {
    cond.split(",").forEach((c) => {
      const parts = c.split(/[=><]/);
      if (parts.length === 2) mentionedInConds.add(parts[0].trim());
    });
  }

  const varMap = new Map<string, string>();
  for (const v of variables) {
    const expr = v.expr || "";
    const replacementStr =
      expr.includes(".") || expr.includes("[") ? `\${${expr}}` : `\${${v.name}}`;
    if (v.name) varMap.set(v.name, replacementStr);
    if (expr) varMap.set(expr, replacementStr);
  }
  for (const name of mentionedInConds) if (!varMap.has(name)) varMap.set(name, `\${${name}}`);

  let translatedText = String(text as any).replace(
    /\{([^}]+)\}/g,
    (match, key) => varMap.get(key.trim()) || match,
  );
  if (tagMap && tagMap.length) {
    translatedText = reconstructTags(translatedText, tagMap, convertFn);
  }
  return `(${jsCondition}) ? \`${translatedText}\` : ${buildTernary(entries, variables, index + 1, tagMap, convertFn)}`;
}

function parseConditionToJS(condition: string, variables: VariableBinding[]): string {
  return condition
    .split(",")
    .map((c) => {
      let op = "==";
      let sep = "=";
      if (c.includes(">")) {
        op = ">";
        sep = ">";
      } else if (c.includes("<")) {
        op = "<";
        sep = "<";
      }

      const parts = c.trim().split(sep);
      if (parts.length !== 2) return "true";

      const left = parts[0].trim();
      const right = parts[1].trim();
      const finalRight =
        !isNaN(Number(right)) && right !== "" ? right : `'${right.replace(/'/g, "\\'")}'`;
      const varBinding = variables.find((v) => v.name === left);
      return `${varBinding ? varBinding.expr : left} ${op} ${finalRight}`;
    })
    .join(" && ");
}
