import { describe, it, expect } from "vite-plus/test";
import { bakeICU } from "../utils/icu-baker.js";

describe("ZCU Macro Baking", () => {
  it("should bake plural ICU strings into optimized JS functions", () => {
    const icu = "{count, plural, =0 {No items} one {One item} other {# items}}";
    const baked = bakeICU(icu, "en");

    expect(baked).toContain("(params) =>");
    expect(baked).toContain("if (params['count'] == 0)");
    expect(baked).toContain("return `No items`;");
    expect(baked).toContain("return `${params['count']} items`;");

    // Evaluation test
    // eslint-disable-next-line no-eval
    const fn = eval(baked!);
    expect(fn({ count: 0 })).toBe("No items");
    expect(fn({ count: 1 })).toBe("One item");
    expect(fn({ count: 5 })).toBe("5 items");
  });

  it("should handle snake_case variables from member expressions", () => {
    const icu = "Hello {user_name}, welcome to {project_name}!";
    const baked = bakeICU(icu, "en");

    expect(baked).toContain("const { user_name, project_name } = params;");
    // eslint-disable-next-line no-eval
    const fn = eval(baked!);
    expect(fn({ user_name: "Khalid", project_name: "Zintl" })).toBe(
      "Hello Khalid, welcome to Zintl!",
    );
  });

  it("should handle nested ICU structures (Select inside Plural)", () => {
    const icu =
      "{count, plural, one {{gender, select, male {One man} female {One woman} other {One person}}} other {# people}}";
    const baked = bakeICU(icu, "en");

    expect(baked).toContain("Intl.PluralRules('en')");
    expect(baked).toContain("if (params['gender'] === 'male')");

    // eslint-disable-next-line no-eval
    const fn = eval(baked!);
    expect(fn({ count: 1, gender: "male" })).toBe("One man");
    expect(fn({ count: 1, gender: "female" })).toBe("One woman");
    expect(fn({ count: 5 })).toBe("5 people");
  });

  it("should use Intl.PluralRules for keywords in different locales", () => {
    // Arabic has complex plurals
    const icu = "{count, plural, zero {٠} one {١} two {٢} few {قليل} many {كثير} other {غير ذلك}}";
    const baked = bakeICU(icu, "ar");

    expect(baked).toContain("new Intl.PluralRules('ar')");

    // eslint-disable-next-line no-eval
    const fn = eval(baked!);
    expect(fn({ count: 0 })).toBe("٠");
    expect(fn({ count: 1 })).toBe("١");
    expect(fn({ count: 2 })).toBe("٢");
    expect(fn({ count: 3 })).toBe("قليل"); // 3-10 is 'few' in Arabic
    expect(fn({ count: 11 })).toBe("كثير"); // 11-99 is 'many'
    expect(fn({ count: 100 })).toBe("غير ذلك");
  });
});
