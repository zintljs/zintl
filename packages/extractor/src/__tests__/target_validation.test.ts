/**
 * A descriptor either matches or is refused. It is never ignored.
 *
 * Every unmatched string used to fall out of `resolveTargets` contributing
 * nothing — no target, no hint, no message. So a typo and a form that does not
 * exist both resolved to silence, and the user who asked for an extraction got
 * none with nothing to read. That is the same silent under-extraction that
 * makes a missing sink invisible, arriving through a config file, where it is
 * worse: the intent was stated out loud and dropped.
 */
import { describe, it, expect } from "vite-plus/test";
import { resolveTargets } from "../targets.js";
import type { TargetDescriptor } from "../types.js";

const resolve = (t: string) => () => resolveTargets([t as TargetDescriptor]);

describe("extraction target validation", () => {
  it("accepts every documented form", () => {
    for (const form of [
      "jsx:*:alt",
      "jsx:html:dir",
      "html:attr:placeholder",
      "dom:*:innerHTML",
      "dom:prop:textContent",
      "dom:document:title",
      "obj:field:label",
      "obj:*:label",
      "obj:ui:title",
      "call:defineConfig:title",
      "tag:html",
    ]) {
      expect(resolve(form)).not.toThrow();
    }
  });

  it("refuses a form that does not exist", () => {
    expect(resolve("wat:something")).toThrow(/Invalid extraction target.*wat:something/s);
    expect(resolve("wat:something")).toThrow(/unrecognised form/);
  });

  it("refuses a misspelled prefix rather than matching nothing", () => {
    expect(resolve("domprop:title")).toThrow(/Invalid extraction target/);
    expect(resolve("jsx:alt")).toThrow(/three colon-separated parts, got 2/);
    expect(resolve("dom:title")).toThrow(/three colon-separated parts, got 2/);
  });

  it("refuses empty segments", () => {
    expect(resolve("jsx:*:")).toThrow(/one of its parts is empty/);
    expect(resolve("obj:field:")).toThrow(/one of its parts is empty/);
    expect(resolve("dom:document:")).toThrow(/one of its parts is empty/);
    expect(resolve("call:fn:")).toThrow(/one of its parts is empty/);
    expect(resolve("tag:")).toThrow(/nothing follows "tag:"/);
  });

  it("refuses a path where a single name is expected", () => {
    expect(resolve("html:attr:a:b")).toThrow(/takes a single name, not a path/);
  });

  /**
   * `dom:attr:` was in the descriptor union and in this module's own docblock,
   * and was never implemented — it registered a fast-path hint and joined no
   * target set. A form that has never worked should not keep looking like it
   * does.
   */
  it("refuses dom:attr:, which was declared but never implemented", () => {
    expect(resolve("dom:attr:href")).toThrow(/`dom:attr:` is not implemented/);
  });

  it("names the valid forms in the error, so the message is actionable", () => {
    expect(resolve("wat:something")).toThrow(/dom:<receiver>:<property>/);
    expect(resolve("wat:something")).toThrow(/call:<function>:<field>/);
    expect(resolve("wat:something")).toThrow(/docs\/configuration\.md/);
  });
});
