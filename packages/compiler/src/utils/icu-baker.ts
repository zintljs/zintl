import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import type { ZintlLogger } from "../types/index.js";

/**
 * Converts ICU MessageFormat AST into a highly optimized Zintl-flavored JS function (Macro Baking).
 * Supports Plural and Select with nesting.
 */
const bakeCache = new Map<string, string | null>();

export function bakeICU(icuString: string, locale: string, logger?: ZintlLogger): string | null {
  const cacheKey = `${locale}:${icuString}`;
  if (bakeCache.has(cacheKey)) return bakeCache.get(cacheKey)!;

  try {
    const ast = parse(icuString);
    if (ast.length === 1 && ast[0].type === TYPE.literal) {
      return null; // Not an ICU string that needs baking, just a literal
    }

    // Check if it really needs logic (contains plural/select/arguments)
    const hasLogic = ast.some(
      (el) => el.type === TYPE.plural || el.type === TYPE.select || el.type === TYPE.argument,
    );
    if (!hasLogic) {
      bakeCache.set(cacheKey, null);
      return null;
    }

    const result = generateBakerLambda(ast, locale);
    bakeCache.set(cacheKey, result);
    return result;
  } catch (e: any) {
    if (logger) {
      logger.warn(
        `Failed to bake ICU string: "${icuString}" in locale "${locale}". Error: ${e.message}`,
      );
    }
    // If it's not valid ICU, return null to let it be treated as a normal string
    return null;
  }
}

function generateBakerLambda(ast: MessageFormatElement[], locale: string): string {
  const vars = getUsedVariables(ast);
  const destructuring = vars.length > 0 ? `const { ${vars.join(", ")} } = params;` : "";
  const body = generateElementCode(ast, locale);
  return `(params) => {
    ${destructuring}
    return ${body};
  }`;
}

function generateElementCode(
  elements: MessageFormatElement[],
  locale: string,
  pluralArg?: string,
): string {
  if (elements.length === 0) return "''";

  return elementsToTemplateLiteral(elements, locale, pluralArg);
}

// Cleaner join for template literals
function elementsToTemplateLiteral(
  elements: MessageFormatElement[],
  locale: string,
  pluralArg?: string,
): string {
  let result = "`";
  for (const el of elements) {
    switch (el.type) {
      case TYPE.literal:
        result += escapeLiteral(el.value);
        break;
      case TYPE.argument:
        result += `\${params['${el.value}']}`;
        break;
      case TYPE.pound:
        result += `\${params['${pluralArg}']}`;
        break;
      case TYPE.plural:
        result += `\${${generatePluralCode(el, locale)}}`;
        break;
      case TYPE.select:
        result += `\${${generateSelectCode(el, locale)}}`;
        break;
    }
  }
  result += "`";
  return result;
}

function generatePluralCode(el: any, locale: string): string {
  const arg = el.value;
  let code = "(() => {\n";

  const options = el.options;
  const exacts = Object.keys(options).filter((k) => k.startsWith("="));
  const keywords = Object.keys(options).filter((k) => !k.startsWith("=") && k !== "other");

  for (const key of exacts) {
    const val = key.slice(1);
    code += `      if (params['${arg}'] == ${val}) return ${elementsToTemplateLiteral(options[key].value, locale, arg)};\n`;
  }

  if (keywords.length > 0) {
    code += `      const rule = new Intl.PluralRules('${locale}').select(params['${arg}']);\n`;
    for (const key of keywords) {
      code += `      if (rule === '${key}') return ${elementsToTemplateLiteral(options[key].value, locale, arg)};\n`;
    }
  }

  code += `      return ${elementsToTemplateLiteral(options.other.value, locale, arg)};\n`;
  code += "    })()";
  return code;
}

function generateSelectCode(el: any, locale: string): string {
  const arg = el.value;
  let code = "(() => {\n";
  const options = el.options;

  for (const key of Object.keys(options)) {
    if (key === "other") continue;
    code += `      if (params['${arg}'] === '${key}') return ${elementsToTemplateLiteral(options[key].value, locale)};\n`;
  }

  code += `      return ${elementsToTemplateLiteral(options.other.value, locale)};\n`;
  code += "    })()";
  return code;
}

function getUsedVariables(elements: MessageFormatElement[]): string[] {
  const vars = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if ("value" in el && typeof el.value === "string" && el.type !== TYPE.literal) {
        vars.add(el.value);
      }
      if ("options" in el) {
        for (const opt of Object.values(el.options) as any) {
          walk(opt.value);
        }
      }
    }
  };
  walk(elements);
  return Array.from(vars);
}

function escapeLiteral(val: string): string {
  return val.replace(/`/g, "\\`").replace(/\${/g, "\\${");
}
