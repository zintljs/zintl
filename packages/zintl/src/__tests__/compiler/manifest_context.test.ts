/**
 * `ManifestEntry.context` — where a string appears, as something to show a
 * translator.
 *
 * Metadata, never a key (proposal 032 §8.1). These tests exist to pin both
 * halves of that: the value is useful to a human, and populating it changes
 * nothing about identity. The second half is the one worth guarding — the
 * field's whole safety argument is that it cannot split a message.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("ManifestEntry.context", () => {
  let compiler: ZintlCompiler;
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-manifest-context-");
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

  /** Every manifest entry, flattened, as `text → context`. */
  const contexts = () => {
    const out: Record<string, (string | undefined)[]> = {};
    for (const entries of Object.values(compiler.messages.internalManifest)) {
      for (const e of entries) (out[e.text] ??= []).push(e.context);
    }
    return out;
  };

  it("records the JSX element a string sat in", async () => {
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        zintl(navigator.language);
        export const App = () => <button>Save changes</button>;
      `,
      join(root, "src/App.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    expect(contexts()["Save changes"]).toEqual(["button"]);
  });

  /**
   * `html:attr:alt` names the attribute *and* the splice mechanism. A
   * translator can act on `alt` and not on the prefix, so it is dropped.
   */
  it("strips the transport prefix from an HTML attribute sink", async () => {
    await compiler.transform(
      `<html><body><img alt="A cat asleep" src="/c.png"><p>Hello there</p></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const found = contexts();
    expect(found["A cat asleep"]).toEqual(["alt"]);
    // And an HTML text node names the element it sat in, not its sink type.
    expect(found["Hello there"]).toEqual(["p"]);
  });

  /**
   * The gap 032 §3 assumed away, now closed.
   *
   * This test used to assert the opposite — that an `<h1>` and a `<p>` were
   * indistinguishable — because every HTML text node reached the compiler as
   * one `sinkType`. `stitchHTML` now tracks the open block elements and reports
   * the enclosing one, so §3's "this is an `aria-label`, not an `h1`" is true
   * for HTML and not only for JSX.
   */
  it("tells an HTML heading from an HTML paragraph", async () => {
    await compiler.transform(
      `<html><body><h1>A heading</h1><p>A paragraph</p></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const found = contexts();
    expect(found["A heading"]).toEqual(["h1"]);
    expect(found["A paragraph"]).toEqual(["p"]);
  });

  /**
   * The element is the *block* the text reads as, not whatever tag happens to
   * wrap it. Stitching treats a single wrapping phrasing tag as a partition, so
   * following its own phrasing decision would report `b` here.
   */
  it("reports the block element, not an inline wrapper", async () => {
    await compiler.transform(
      `<html><body><p><b>Bold sentence</b></p><li>A list item</li></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const found = contexts();
    expect(found["Bold sentence"]).toEqual(["p"]);
    expect(found["A list item"]).toEqual(["li"]);
  });

  /**
   * No answer beats a wrong one: a translator acts on this field. Unbalanced
   * markup unwinds to the match rather than leaving an element open and
   * mislabelling everything after it.
   */
  it("does not carry a stale element past unbalanced markup", async () => {
    await compiler.transform(
      `<html><body><div><p>Inside both</div><h2>After the mess</h2></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const found = contexts();
    expect(found["Inside both"]).toEqual(["p"]);
    expect(found["After the mess"]).toEqual(["h2"]);
  });

  /**
   * The safety property the whole design rests on: context annotates a message,
   * it never splits one. Identity is `sha1(text)` and ignores context, so the
   * same string reached two ways stays one id.
   */
  it("does not split a message reached through two different sinks", async () => {
    await compiler.transform(
      `<html><body><img alt="Open" src="/a.png"><button title="Open"></button></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const ids = new Set<string>();
    for (const entries of Object.values(compiler.messages.internalManifest)) {
      for (const e of entries) if (e.text === "Open") ids.add(e.id);
    }

    // Two sinks, two entries carrying different contexts, and deliberately
    // *one* identity between them.
    expect(
      contexts()
        ["Open"]?.slice()
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(["alt", "title"]);
    expect(ids.size).toBe(1);
  });

  it("leaves context unset for an explicit t() call, which has no sink", async () => {
    await compiler.transform(
      `
        import { zintl, t } from "zintljs";
        zintl(navigator.language);
        console.log(t("Assembled at runtime"));
      `,
      join(root, "src/main.ts"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    expect(contexts()["Assembled at runtime"]).toEqual([undefined]);
  });
});

/**
 * `getMessageContext` — the same facts, assembled for someone outside the repo.
 *
 * `manifest_context` above is about one field. This is about the derived read
 * on top of it (proposal 032 §3): which screens a string reaches, what else an
 * edit to it would change, and what expression is behind `{name}`. None of it
 * is new machinery — all of it is a read off graphs the compiler already keeps —
 * which is why it cannot go stale the way a hand-typed TMS context field does.
 *
 * Wired rather than pure: `message-context.test.ts` covers the derivation
 * against hand-built graphs, and this covers the wiring against a real one.
 */
describe("getMessageContext", () => {
  let compiler: ZintlCompiler;
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-message-context-");
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

  /** Two entries, one shared component, one string in all three. */
  async function seedSharedProject() {
    await compiler.transform(
      `
        import { t } from "zintljs";
        export const Footer = () => <footer>{t("Save changes")}</footer>;
      `,
      join(root, "src/Footer.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        import { Footer } from "./Footer.tsx";
        zintl(navigator.language);
        export const Checkout = () => <div><button>Save changes</button><Footer /></div>;
      `,
      join(root, "src/Checkout.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        zintl(navigator.language);
        export const Settings = () => <button>Save changes</button>;
      `,
      join(root, "src/Settings.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();
  }

  it("returns null for a string the boundary does not carry", async () => {
    await seedSharedProject();
    expect(compiler.getMessageContext("src/Checkout.tsx:Checkout", "Nothing here")).toBeNull();
  });

  it("says where the string sits and what else an edit would change", async () => {
    await seedSharedProject();
    const ctx = compiler.getMessageContext("src/Checkout.tsx:Checkout", "Save changes")!;

    expect(ctx).not.toBeNull();
    expect(ctx.occurrences[0].context).toBe("button");

    // The fact no TMS can compute: the same words live in two other boundaries,
    // so translating this one changes them too.
    expect(ctx.sharedWith).toEqual(["src/Footer.tsx:Footer", "src/Settings.tsx:Settings"]);
  });

  it("names the screens that reach a shared boundary", async () => {
    await seedSharedProject();
    const ctx = compiler.getMessageContext("src/Footer.tsx:Footer", "Save changes")!;

    // Reached from Checkout, which imports it, and not from Settings, which
    // does not — the boundary graph answering a question about screens.
    expect(ctx.screens).toEqual(["src/Checkout.tsx"]);
  });

  /**
   * `{name}` alone is unanswerable — a translator cannot tell whether it will
   * be a person, a product or a count. `user.firstName` is not.
   */
  it("carries the expression behind a JSX placeholder", async () => {
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        zintl(navigator.language);
        export const Hi = ({ user }) => <h1>Welcome back, {user.firstName}!</h1>;
      `,
      join(root, "src/Hi.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const key = compiler.getMessages("src/Hi.tsx:Hi")[0].text;
    expect(key).toContain("{user_firstName}");

    const ctx = compiler.getMessageContext("src/Hi.tsx:Hi", key)!;
    expect(ctx.occurrences[0].variables).toEqual([
      { name: "user_firstName", expression: "user.firstName" },
    ]);
  });

  /**
   * The second gap of the same family, also closed.
   *
   * This asserted the opposite until the cause was found: the JSX visitor kept
   * its own copy of the name derivation that handled only `Identifier`, so
   * `${user.firstName}` was named `var0` there and `user_firstName` in the
   * text. The two are paired *by name*, so the mismatch did not produce a wrong
   * binding — it produced none, silently. One copy now, in `variables.ts`.
   */
  it("names the expression behind a template-literal placeholder", async () => {
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        zintl(navigator.language);
        export const Hi = ({ user }) => <h1>{\`Welcome back, \${user.firstName}!\`}</h1>;
      `,
      join(root, "src/Tpl.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const key = compiler.getMessages("src/Tpl.tsx:Hi")[0].text;
    expect(key).toContain("{user_firstName}");

    const ctx = compiler.getMessageContext("src/Tpl.tsx:Hi", key)!;
    expect(ctx.occurrences[0].variables).toEqual([
      { name: "user_firstName", expression: "user.firstName" },
    ]);
  });

  /**
   * The attribute form of the same shape, which took the third route through
   * the extractor and was broken for the same reason.
   */
  it("names the expression behind a template-literal attribute", async () => {
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        zintl(navigator.language);
        export const Pic = ({ user }) => <img alt={\`Photo of \${user.firstName}\`} src="/p.png" />;
      `,
      join(root, "src/Pic.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const key = compiler.getMessages("src/Pic.tsx:Pic")[0].text;
    const ctx = compiler.getMessageContext("src/Pic.tsx:Pic", key)!;
    expect(ctx.occurrences[0].variables).toEqual([
      { name: "user_firstName", expression: "user.firstName" },
    ]);
  });
});
