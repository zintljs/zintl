/**
 * What a translation has to satisfy before it is allowed into a catalog.
 *
 * Zintl had no validation of catalog values at all, and that was defensible
 * while catalogs were hand-edited beside the code by someone who could see what
 * they broke. Round-tripping through a system that hands translators raw ICU
 * syntax is a different situation (032 §4), and every check here is something
 * the compiler can *know* is wrong rather than suspect.
 *
 * Written against the pure module, because the interesting cases are
 * linguistic — Arabic has six plural categories and English has two — and
 * stating them directly is shorter and more precise than producing them from a
 * real project.
 *
 * The reasons are asserted as *text*, not as codes. Whoever reads one of these
 * is usually not the person who caused it, often does not have the repository,
 * and needs to know what to do next; a reason that only identifies the rule is
 * a reason that sends them to ask someone else.
 */
import { describe, it, expect } from "vite-plus/test";
import { checkTranslation, formatImportProblems } from "../import-gate.js";

describe("checkTranslation", () => {
  it("accepts an ordinary translation", () => {
    expect(checkTranslation("Save changes", "حفظ التغييرات", "ar")).toBeNull();
  });

  /**
   * Absence is not corruption. An empty value means exactly what an empty
   * catalog entry means, and `verifyIntegrity` already reports that — refusing
   * it here would produce two different errors for one condition.
   */
  it("passes an empty translation through to the missing-translation gate", () => {
    expect(checkTranslation("Save changes", "", "ar")).toBeNull();
    expect(checkTranslation("Save changes", "   ", "ar")).toBeNull();
  });

  describe("placeholders", () => {
    it("refuses one that was dropped", () => {
      const reason = checkTranslation("Welcome back, {name}!", "مرحباً بعودتك!", "ar");
      expect(reason).toContain("{name}");
      expect(reason).toContain("missing from the translation");
    });

    it("refuses one that was renamed", () => {
      const reason = checkTranslation("Welcome back, {name}!", "مرحباً، {nom}!", "ar");
      // Named both ways round, because a rename is a drop and an invention at once.
      expect(reason).toMatch(/\{name\}|\{nom\}/);
    });

    /**
     * An invented placeholder is worse than a missing one: nothing will ever
     * supply it, so it reaches a user as literal braces.
     */
    it("refuses one the source never had", () => {
      const reason = checkTranslation("Welcome back!", "مرحباً، {name}!", "ar");
      expect(reason).toContain("{name}");
      expect(reason).toContain("not in the source string");
    });

    it("accepts one that moved", () => {
      expect(checkTranslation("Hello {name}, welcome", "{name} أهلاً بك", "ar")).toBeNull();
    });
  });

  describe("markup", () => {
    it("refuses a dropped tag", () => {
      const reason = checkTranslation("Hello <b>there</b>", "مرحباً there", "ar");
      expect(reason).toContain("markup does not match");
    });

    it("refuses a mangled alias", () => {
      const reason = checkTranslation("Read the <t0>docs</t0>", "اقرأ <t1>الوثائق</t1>", "ar");
      expect(reason).toContain("markup does not match");
    });

    it("accepts markup that was reordered around the words", () => {
      expect(checkTranslation("Hello <b>there</b>", "<b>مرحباً</b> بك", "ar")).toBeNull();
    });
  });

  describe("ICU", () => {
    it("refuses syntax the parser cannot read", () => {
      const reason = checkTranslation(
        "{count, plural, one {# item} other {# items}}",
        "{count, plural, one {# عنصر} other {# عناصر}",
        "ar",
      );
      expect(reason).toContain("not valid ICU syntax");
    });

    /**
     * The check no other tool seems to make. Arabic has six plural categories;
     * a translator working from an English source sees two, and a TMS that
     * round-trips the English shape produces a message that silently renders
     * the wrong form for four of them.
     */
    it("refuses a message missing forms the language requires", () => {
      const reason = checkTranslation(
        "{count, plural, one {# item} other {# items}}",
        "{count, plural, one {# عنصر} other {# عناصر}}",
        "ar",
      );
      expect(reason).toContain("zero");
      expect(reason).toContain("few");
      expect(reason).toContain('"ar" requires');
      expect(reason).toContain("fall through");
    });

    it("refuses a category the language does not have", () => {
      const reason = checkTranslation(
        "{count, plural, one {# item} other {# items}}",
        "{count, plural, one {# item} few {# items} other {# items}}",
        "en",
      );
      expect(reason).toContain('"few" is not a plural category in "en"');
      expect(reason).toContain("one, other");
    });

    it("accepts a complete set for the target language", () => {
      const complete =
        "{count, plural, zero {لا عناصر} one {عنصر} two {عنصران} " +
        "few {# عناصر} many {# عنصراً} other {# عنصر}}";
      expect(
        checkTranslation("{count, plural, one {# item} other {# items}}", complete, "ar"),
      ).toBeNull();
    });

    /** `=0` is an exact match rather than a category, and is always legal. */
    it("accepts exact-match branches alongside the categories", () => {
      expect(
        checkTranslation(
          "{count, plural, one {# item} other {# items}}",
          "{count, plural, =0 {nothing} one {# item} other {# items}}",
          "en",
        ),
      ).toBeNull();
    });

    /**
     * An unknown locale is not a reason to refuse someone's work. `Intl` cannot
     * answer, so the plural check abstains rather than guessing.
     */
    it("abstains for a locale Intl does not know", () => {
      expect(
        checkTranslation(
          "{count, plural, one {# item} other {# items}}",
          "{count, plural, one {# item} other {# items}}",
          "zz-nonsense-locale",
        ),
      ).toBeNull();
    });

    /**
     * A source that is itself unparseable is not the translation's fault, and
     * blaming the translator for it would send them to a file they cannot see.
     */
    it("does not blame a translation for a broken source", () => {
      expect(checkTranslation("Unclosed {brace", "ترجمة", "ar")).toBeNull();
    });
  });
});

describe("formatImportProblems", () => {
  const problem = (locale: string, key: string, reason: string) => ({
    locale,
    key,
    value: "x",
    reason,
  });

  it("reports every problem at once, grouped by locale", () => {
    const report = formatImportProblems([
      problem("ar", "Save changes", "{name} is missing from the translation"),
      problem("ar", "Welcome back", "the markup does not match the source"),
      problem("fr", "Sign out", "not valid ICU syntax"),
    ]);

    expect(report).toContain("3 translations would render incorrectly");
    expect(report).toContain("across 2 locales");
    expect(report).toContain("ar — 2 refused");
    expect(report).toContain("fr — 1 refused");
    expect(report).toContain("{name} is missing");
  });

  /**
   * The sentence that stops someone reaching for `git checkout`. A refused
   * import writes nothing at all, and the report has to say so — otherwise the
   * reasonable assumption is that some of it landed.
   */
  it("says the catalogs were not touched", () => {
    const report = formatImportProblems([problem("ar", "Save", "bad")]);
    expect(report).toContain("catalogs on disk are untouched");
    expect(report).toContain("nothing here has been written");
  });

  it("truncates a long list rather than scrolling the actionable part away", () => {
    const many = Array.from({ length: 12 }, (_, i) => problem("ar", `String ${i}`, "bad"));
    const report = formatImportProblems(many);
    expect(report).toContain("… and 4 more");
  });
});
