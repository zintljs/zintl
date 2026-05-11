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

const PRIORITY = {
  bake: 100,
  sink_wrap: 80,
  manual_t: 70,
  anchor: 50,
  quote_convert: 10,
};

/**
 * Resolve rewrite intents into ordered operations.
 */
export function resolveRewrites(
  intents: TransformIntent[],
  config: ZintlConfig,
): ResolvedRewrite[] {
  const rewrites: ResolvedRewrite[] = [];

  for (const intent of intents) {
    switch (intent.type) {
      case "anchor_rewrite":
        rewrites.push(generateAnchorRewrite(intent, config));
        break;
      case "sink_wrap":
        rewrites.push(generateSinkWrapRewrite(intent));
        break;
      case "manual_t_rewrite":
        rewrites.push(generateManualTRewrite(intent));
        break;
      case "baking":
        rewrites.push(generateBakeRewrite(intent));
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
            (match, key) => varMap.get(key) || match,
          );
        }

        let finalReplacement = replacement;
        if (!intent.sink.isFragment) {
          finalReplacement =
            intent.sink.sinkType === "TemplateLiteral" || intent.sink.sinkType === "HTML"
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
    replacement: `loadI18nInstance({ ${localePart}${debugPart}loaders: { ${loadersObj} } })`,
    kind: "anchor",
    priority: PRIORITY.anchor,
  };
}

function generateSinkWrapRewrite(intent: SinkWrapIntent): ResolvedRewrite {
  const params = intent.variables || [];
  const paramsObj =
    params.length > 0 ? `, { ${params.map((p) => `${p.name}: ${p.expr}`).join(", ")} }` : "";
  const mgrRef = `_zintl_mgr_${intent.safeId}`;
  const keyIdentifier =
    intent.isDev && intent.sink.text ? intent.sink.text : intent.messageId || intent.sink.text;

  let replacement = `_t(${JSON.stringify(keyIdentifier)}${paramsObj}, { _mgr: ${mgrRef}, _bId: ${JSON.stringify(intent.boundaryId)} })`;
  if (intent.sink.isFragment) replacement = `\${${replacement}}`;

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

function generateBakeRewrite(intent: BakingIntent): ResolvedRewrite {
  let baked = bakeTranslation(intent.translation, intent.variables || [], intent.sink.isFragment);
  if (
    !intent.sink.isFragment &&
    (intent.sink.sinkType === "TemplateLiteral" || intent.sink.sinkType === "HTML") &&
    !baked.startsWith("`")
  ) {
    baked = "`" + (baked.startsWith('"') ? JSON.parse(baked) : baked) + "`";
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
): string {
  if (typeof translation === "string") {
    if (translation.includes("{")) {
      const varMap = new Map<string, string>();
      for (const v of variables) {
        const expr = v.expr || "";
        const replacementStr =
          expr.includes(".") || expr.includes("[") ? `\${${expr}}` : `\${${v.name}}`;
        if (v.name) varMap.set(v.name, replacementStr);
        if (expr) varMap.set(expr, replacementStr);
      }
      const replaced = translation.replace(
        /\{([^}]+)\}/g,
        (match, key) => varMap.get(key) || match,
      );
      return isFragment ? replaced : "`" + replaced + "`";
    }
    return isFragment ? translation : JSON.stringify(translation);
  }
  return typeof translation === "object"
    ? buildTernary(Object.entries(translation), variables, 0)
    : '""';
}

function buildTernary(
  entries: [string, string | Record<string, string>][],
  variables: VariableBinding[],
  index: number,
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

  const translatedText = String(text as any).replace(
    /\{([^}]+)\}/g,
    (match, key) => varMap.get(key) || match,
  );
  return `(${jsCondition}) ? \`${translatedText}\` : ${buildTernary(entries, variables, index + 1)}`;
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
