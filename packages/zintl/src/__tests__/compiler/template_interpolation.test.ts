/**
 * A template literal's interpolations must reach the `t()` call that replaces it.
 *
 * This started as a metadata question — proposal 032 §3 wants to tell a
 * translator that `{input}` is `user.firstName` — and turned out to be a
 * rendering bug. The JSX visitor kept its own copy of the name derivation that
 * handled only `Identifier`, so `${user.firstName}` was named `var0` there and
 * `user_firstName` in the extracted text. Bindings are paired to placeholders
 * **by name**, so the mismatch dropped the binding rather than mis-naming it:
 *
 * ```
 * _t("Welcome back, {user_firstName}!", { _mgr, _bId })
 * ```
 *
 * No params object. The placeholder had nothing bound to it, so the UI rendered
 * the literal text `{user_firstName}` to a user.
 *
 * Nothing caught it, and the reason is worth recording: **no example uses a
 * template literal inside JSX.** `vanilla-ssr/src/counter.ts` uses one on a DOM
 * assignment, which takes a different route through the extractor — the route
 * that was already correct. So the 383-test contract suite is blind to this
 * shape, and these tests are the coverage, asserting the *emitted call* rather
 * than the manifest because the emitted call is what a user runs.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Template literal interpolation", () => {
  let compiler: ZintlCompiler;
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-template-interp-");
    context.root = root;
    compiler = createTestCompiler(
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "zintl",
        logLevel: "silent",
        verifyIntegrity: false,
      },
      root,
      true,
    );
    await compiler.setup();
    await mkdir(join(root, "src"), { recursive: true });
  });

  const emitted = async (source: string, file: string) => {
    const res = await compiler.transform(source, join(root, file), "virtual:zintl/inject");
    return res!.code;
  };

  it("binds a member expression inside a JSX expression container", async () => {
    const code = await emitted(
      [
        `import { zintl } from "zintljs";`,
        `zintl(navigator.language);`,
        "export const Hi = ({ user }) => <h1>{`Welcome back, ${user.firstName}!`}</h1>;",
      ].join("\n"),
      "src/Hi.tsx",
    );

    expect(code).toContain('"Welcome back, {user_firstName}!"');
    // The binding, without which the placeholder renders as literal braces.
    expect(code).toContain("{ user_firstName: user.firstName }");
  });

  it("binds one inside a JSX attribute", async () => {
    const code = await emitted(
      [
        `import { zintl } from "zintljs";`,
        `zintl(navigator.language);`,
        'export const Pic = ({ user }) => <img alt={`Photo of ${user.firstName}`} src="/p.png" />;',
      ].join("\n"),
      "src/Pic.tsx",
    );

    expect(code).toContain("{ user_firstName: user.firstName }");
  });

  /**
   * The route that always worked, kept as a control. If this ever breaks while
   * the two above pass, the consolidation went the wrong way.
   */
  it("still binds one on a DOM assignment", async () => {
    const code = await emitted(
      [
        `import { zintl } from "zintljs";`,
        `zintl(navigator.language);`,
        "export function render(el, user) { el.textContent = `Welcome back, ${user.firstName}!`; }",
      ].join("\n"),
      "src/dom.ts",
    );

    expect(code).toContain("{ user_firstName: user.firstName }");
  });

  it("binds a plain identifier", async () => {
    const code = await emitted(
      [
        `import { zintl } from "zintljs";`,
        `zintl(navigator.language);`,
        "export const Hi = ({ name }) => <h1>{`Hello, ${name}!`}</h1>;",
      ].join("\n"),
      "src/Name.tsx",
    );

    expect(code).toContain('"Hello, {name}!"');
    expect(code).toContain("{ name: name }");
  });

  /**
   * Two interpolations, one of which has no readable name. The unnamed one
   * still has to be *bound* — a positional name is a worse label, not a reason
   * to drop the value.
   */
  it("binds an expression it cannot name", async () => {
    const code = await emitted(
      [
        `import { zintl } from "zintljs";`,
        `zintl(navigator.language);`,
        "export const Cart = ({ user, items }) =>",
        "  <p>{`${user.name} has ${items.filter(Boolean).length} items`}</p>;",
      ].join("\n"),
      "src/Cart.tsx",
    );

    expect(code).toContain("user_name: user.name");
    expect(code).toContain("length: items.filter(Boolean).length");
  });
});
