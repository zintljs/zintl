/**
 * @module pipeline/validate
 *
 * Phase 5: VALIDATE — Post-condition Phase
 *
 * "Did we break it?"
 *
 * This phase performs final sanity checks on the transformed source code
 * to ensure integrity, correctness, and that no zintl artifacts remain.
 */

import type {
  TransformResult,
  FileObservation,
  ValidationResult,
  ValidateFn,
  ResolvedPlan,
  ValidationError,
  ZintlLogger,
} from "./types.js";

/**
 * Validate the transformation result against the original observation.
 */
export const validate: ValidateFn = (
  result: TransformResult,
  plan: ResolvedPlan,
  _observation: FileObservation,
  logger: ZintlLogger,
): ValidationResult => {
  logger.debug("Validating transformation result...");
  const errors: ValidationError[] = [];

  // 1. Verify all planned runtime symbols are present
  validateImports(result, plan, errors);

  // 2. Verify all planned prepends (managers) are present
  validatePrepends(result, plan, errors);

  // 3. Scan for stray zintl() calls or markers
  validateStrays(result, errors);

  // 3. Basic Source Map sanity check
  validateMap(result, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
};

function validateImports(result: TransformResult, plan: ResolvedPlan, errors: ValidationError[]) {
  const { code } = result;

  // We only care about specifiers that are actually USED in our planned rewrites.
  const usedSpecifiers = new Set<string>();
  for (const rewrite of plan.rewrites) {
    if (rewrite.replacement.includes("loadI18nInstance")) usedSpecifiers.add("loadI18nInstance");
    if (rewrite.replacement.match(/\b_t\(/)) usedSpecifiers.add("_t");
  }

  for (const imp of plan.imports) {
    for (const specifier of imp.specifiers) {
      if (!usedSpecifiers.has(specifier)) continue;

      const hasSpecifier = new RegExp(`\\b${specifier}\\b`).test(code);
      const hasSource = new RegExp(`from\\s*['"]${imp.source}['"]`).test(code);

      if (!hasSpecifier || !hasSource) {
        errors.push({
          type: "missing_import",
          name: specifier,
        });
      }
    }
  }
}

function validatePrepends(result: TransformResult, plan: ResolvedPlan, errors: ValidationError[]) {
  const { code } = result;

  for (const prepend of plan.prepends) {
    if (!code.includes(prepend.code)) {
      errors.push({
        type: "missing_import", // We'll reuse missing_import for now or add MissingPrependError
        name: prepend.code,
      } as any);
    }
  }
}

function validateStrays(result: TransformResult, errors: ValidationError[]) {
  const { code } = result;

  // Robust stripping for validation purposes to avoid false positives in comments and strings
  const codeWithoutDistractions = code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, (match) => " ".repeat(match.length)) // Comments
    .replace(/'(?:\\.|[^'\\])*'/g, (match) => " ".repeat(match.length)) // Single quotes
    .replace(/"(?:\\.|[^"\\])*"/g, (match) => " ".repeat(match.length)) // Double quotes
    .replace(/`(?:\\.|[^`\\])*`/g, (match) => " ".repeat(match.length)); // Template literals

  // zintl() should be gone! (Negative lookahead to ignore plugin config zintl({...}))
  const zintlMatcher = /\bzintl\s*\((?!\s*\{)/g;
  let match;
  while ((match = zintlMatcher.exec(codeWithoutDistractions)) !== null) {
    const start = Math.max(0, match.index - 20);
    const end = Math.min(code.length, match.index + 20);
    const snippet = code.substring(start, end).replace(/\n/g, "\\n");

    errors.push({
      type: "stray_marker",
      marker: `zintl( at "...${snippet}..."`,
    });
  }

  // import "zintljs" (side-effect marker) should also be gone
  if (/\bimport\s+['"]zintl['"]/.test(codeWithoutDistractions)) {
    errors.push({
      type: "stray_marker",
      marker: 'import "zintljs"',
    });
  }
}

function validateMap(_result: TransformResult, _errors: ValidationError[]) {
  // Map validation logic can go here
}
