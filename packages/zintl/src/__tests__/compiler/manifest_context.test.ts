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
    // And the position-naming sink type becomes a word rather than a constant.
    expect(found["Hello there"]).toEqual(["text"]);
  });

  /**
   * A known gap, asserted so it is visible rather than discovered.
   *
   * JSX reports the element a string sat in (`button`), because the visitor has
   * it. HTML text reports only `text` — every element collapses to the same
   * sink type upstream, so an `<h1>` and a `<p>` are indistinguishable here.
   * Closing it is extractor work, not compiler work; see proposal 032 §3.
   */
  it("cannot yet tell an HTML heading from an HTML paragraph", async () => {
    await compiler.transform(
      `<html><body><h1>A heading</h1><p>A paragraph</p></body></html>`,
      join(root, "index.html"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const found = contexts();
    expect(found["A heading"]).toEqual(["text"]);
    expect(found["A paragraph"]).toEqual(["text"]);
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
    expect(contexts()["Open"]?.sort()).toEqual(["alt", "title"]);
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
