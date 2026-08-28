/**
 * What has to be true of a translation before it is allowed into a catalog.
 *
 * ## Why this exists at all
 *
 * Until now there was **no validation of catalog values anywhere**, and that was
 * defensible: catalogs are hand-edited next to the code by someone who can see
 * what they broke. It stops being defensible the moment they round-trip through
 * a system that hands translators raw ICU syntax — which is most of them, and
 * which corrupts it constantly (032 §4).
 *
 * So the import is a **gate, not a merge**. Every check here is something the
 * compiler can *know* is wrong, from material it already has:
 *
 * | Corruption | Caught from |
 * | :--- | :--- |
 * | A dropped or renamed `{count}` | the source text's own placeholders |
 * | A mangled `<t0>` or `<b>` | the tags in the source text |
 * | ICU that no longer parses | the parser the baker already uses |
 * | A plural category the target language does not have | `Intl.PluralRules` |
 *
 * ## Why a pure module
 *
 * Same shape as {@link ./reconcile.ts} and {@link ./message-context.ts}: plain
 * functions over explicit inputs. The interesting cases are linguistic — Arabic
 * has six plural categories and English has two — and stating them directly is
 * both shorter and more precise than producing them from a real project.
 *
 * ## What is deliberately not checked
 *
 * Whether the translation is *good*. Nothing here reads meaning; every check is
 * structural, and a fluent mistranslation passes. That is the correct boundary:
 * this gate exists to catch a machine damaging a string in transit, not to
 * review a human's work.
 */

import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

/** One translation the gate refused, and why, in words a person can act on. */
export interface ImportProblem {
  locale: string;
  key: string;
  value: string;
  /** Phrased for whoever has to fix it, which is usually not the person reading the build log. */
  reason: string;
}

/** Every `{name}` an ICU message references, including plural and select arguments. */
function placeholdersOf(text: string): Set<string> | null {
  let ast: MessageFormatElement[];
  try {
    ast = parse(text);
  } catch {
    return null;
  }

  const names = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if (el.type === TYPE.argument) names.add(el.value);
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        names.add(el.value);
        for (const option of Object.values(el.options)) walk(option.value);
      }
    }
  };
  walk(ast);
  return names;
}

/**
 * Tag tokens, as a sorted multiset.
 *
 * A stitched sentence carries its markup inline — `Hello <b>there</b>` is one
 * message, which is the whole point of stitching — so the tags are part of what
 * must survive the round trip. Compared as a multiset rather than a set because
 * dropping one of two `<b>` pairs is exactly the corruption worth catching.
 */
function tagsOf(text: string): string[] {
  return (text.match(/<[^<>]+>/g) ?? []).sort();
}

/**
 * The plural categories this language actually has.
 *
 * From `Intl.PluralRules`, which is CLDR and built into the runtime — so this
 * needs no data of its own and cannot drift from the rules the baked output
 * will use at runtime. An unknown locale yields `null`, and an unknown locale
 * is not a reason to reject someone's translation.
 */
function pluralCategoriesOf(locale: string): Set<string> | null {
  try {
    return new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
  } catch {
    return null;
  }
}

/** Every plural category used in a message, paired with the argument it belongs to. */
function pluralCategoriesUsed(text: string): { arg: string; category: string }[] {
  let ast: MessageFormatElement[];
  try {
    ast = parse(text);
  } catch {
    return [];
  }

  const used: { arg: string; category: string }[] = [];
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if (el.type === TYPE.plural) {
        for (const category of Object.keys(el.options)) {
          // `=0`, `=1` are exact matches rather than categories, and are always legal.
          if (!category.startsWith("=")) used.push({ arg: el.value, category });
        }
      }
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        for (const option of Object.values(el.options)) walk(option.value);
      }
    }
  };
  walk(ast);
  return used;
}

/**
 * Check one translation against the source it claims to translate.
 *
 * Returns the reason it is unacceptable, or `null` when it passes. One reason
 * rather than a list, deliberately: the first structural fault usually explains
 * the rest, and a translator handed four complaints about one string fixes it
 * once anyway.
 */
export function checkTranslation(key: string, value: string, locale: string): string | null {
  /**
   * An empty translation is *absence*, not corruption.
   *
   * It means the same thing an empty catalog entry means, and `verifyIntegrity`
   * already has the report for it. Refusing it here would produce two different
   * errors for one condition.
   */
  if (value.trim() === "") return null;

  const sourcePlaceholders = placeholdersOf(key);
  const targetPlaceholders = placeholdersOf(value);

  if (targetPlaceholders === null) {
    return sourcePlaceholders === null
      ? null // The source does not parse either, so this is not the translation's fault.
      : `the translation is not valid ICU syntax — a placeholder or plural block is malformed`;
  }

  if (sourcePlaceholders !== null) {
    const missing = [...sourcePlaceholders].filter((n) => !targetPlaceholders.has(n)).sort();
    if (missing.length > 0) {
      return (
        `${missing.map((n) => `{${n}}`).join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} missing from the translation — ` +
        `the value would render with a gap where it should appear`
      );
    }

    /**
     * An *extra* placeholder is worse than a missing one and is reported
     * separately. Nothing will ever supply it, so it renders as literal braces
     * to a user — and the usual cause is a translator typing a name they
     * expected rather than copying the one that is there.
     */
    const unknown = [...targetPlaceholders].filter((n) => !sourcePlaceholders.has(n)).sort();
    if (unknown.length > 0) {
      return (
        `${unknown.map((n) => `{${n}}`).join(", ")} ` +
        `${unknown.length === 1 ? "is" : "are"} not in the source string — ` +
        `nothing will supply ${unknown.length === 1 ? "it" : "them"} at runtime`
      );
    }
  }

  const sourceTags = tagsOf(key);
  const targetTags = tagsOf(value);
  if (sourceTags.join("") !== targetTags.join("")) {
    return (
      `the markup does not match the source — ` +
      `expected ${sourceTags.length > 0 ? sourceTags.join(" ") : "no tags"}, ` +
      `found ${targetTags.length > 0 ? targetTags.join(" ") : "none"}`
    );
  }

  const categories = pluralCategoriesOf(locale);
  if (categories) {
    for (const { arg, category } of pluralCategoriesUsed(value)) {
      if (!categories.has(category)) {
        return (
          `"${category}" is not a plural category in "${locale}" — ` +
          `{${arg}} accepts ${[...categories].sort().join(", ")}`
        );
      }
    }

    /**
     * A missing category is a runtime hole rather than a syntax error: the
     * baked conditional falls through to `other`, so a language with six forms
     * silently renders one of them wrong. `other` is required by ICU itself and
     * is the only one whose absence the parser would already have caught.
     */
    const byArg = new Map<string, Set<string>>();
    for (const { arg, category } of pluralCategoriesUsed(value)) {
      (byArg.get(arg) ?? byArg.set(arg, new Set()).get(arg)!).add(category);
    }
    for (const [arg, used] of byArg) {
      const absent = [...categories].filter((c) => !used.has(c)).sort();
      if (absent.length > 0) {
        return (
          `{${arg}} is missing the ${absent.join(", ")} ` +
          `${absent.length === 1 ? "form" : "forms"} that "${locale}" requires — ` +
          `${absent.length === 1 ? "that count" : "those counts"} would fall through to "other"`
        );
      }
    }
  }

  return null;
}

/**
 * Report every refused translation in one error.
 *
 * The same shape `verifyIntegrity` uses, and for the same reason: refusing on
 * the first one means a project discovers its N problems across N builds, which
 * is the worst possible way to meet a corrupted import.
 *
 * It is a *separate* report rather than folded into the missing-translation one,
 * because they are different problems with different owners. "Your translation
 * system returned data that would render wrong" is not "this string has not
 * been translated", and merging them sends someone to the wrong file.
 */
export function formatImportProblems(problems: ImportProblem[], sample = 8): string {
  const byLocale = new Map<string, ImportProblem[]>();
  for (const p of problems) {
    const list = byLocale.get(p.locale);
    if (list) list.push(p);
    else byLocale.set(p.locale, [p]);
  }

  const locales = Array.from(byLocale.keys()).sort();
  const lines: string[] = [
    `[Zintl Import Error] ${problems.length} ` +
      `${problems.length === 1 ? "translation" : "translations"} would render incorrectly, ` +
      `across ${locales.length} ${locales.length === 1 ? "locale" : "locales"}.`,
    ``,
    `These came back from an import, so the catalogs on disk are untouched —`,
    `nothing here has been written. Fix them at the source and import again.`,
    ``,
  ];

  for (const locale of locales) {
    const list = byLocale.get(locale)!;
    lines.push(`  ${locale} — ${list.length} refused`);
    for (const p of list.slice(0, sample)) {
      const flat = p.key.replace(/\s+/g, " ").trim();
      lines.push(`      "${flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`}"`);
      lines.push(`        ${p.reason}`);
    }
    if (list.length > sample) lines.push(`      … and ${list.length - sample} more`);
    lines.push(``);
  }

  return lines.join("\n");
}
