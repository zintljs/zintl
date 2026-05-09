import { describe, it, expect } from "vite-plus/test";
import { apply } from "../../pipeline/apply.js";
import type { ResolvedPlan } from "../../pipeline/types.js";

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

describe("Pipeline Phase 4: apply()", () => {
  it("should apply multiple transformations correctly", () => {
    // 01234567890123456789012345678901
    // import { zintl } from "zintl";\n (32 chars)
    // function App() {\n (17 chars, total 49)
    //   return <h1>Submit</h1>;\n (26 chars, total 75)
    // }
    const source = `import { zintl } from "zintl";
function App() {
  return <h1>Submit</h1>;
}`;

    const plan: ResolvedPlan = {
      prepends: [{ code: `import _zintl_mgr_h1 from "virtual:zintl/manager/none/entry:h1";` }],
      imports: [
        {
          source: "zintl",
          specifiers: ["t"],
          strategy: "merge",
          location: {
            start: source.indexOf("import { zintl }"),
            end: source.indexOf("import { zintl }") + 'import { zintl } from "zintl";'.length,
            line: 1,
            column: 0,
          },
        },
      ],
      rewrites: [
        {
          start: source.indexOf("Submit"),
          end: source.indexOf("Submit") + "Submit".length,
          replacement: `{t("msg_1", { _mgr: _zintl_mgr_h1, _bId: "App" })}`,
          kind: "sink_wrap",
          priority: 80,
        },
      ],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger);

    expect(result.code).toContain(
      'import _zintl_mgr_h1 from "virtual:zintl/manager/none/entry:h1";',
    );
    expect(result.code).toContain('import { zintl, t } from "zintl";');
    expect(result.code).toContain(
      'return <h1>{t("msg_1", { _mgr: _zintl_mgr_h1, _bId: "App" })}</h1>;',
    );
  });

  it("should handle mixed strategies correctly", () => {
    // 0123456789012345678
    // console.log("Old");
    const source = `console.log("Old");`;
    const plan: ResolvedPlan = {
      prepends: [],
      imports: [{ source: "zintl", specifiers: ["t"], strategy: "new" }],
      rewrites: [{ start: 13, end: 16, replacement: `New`, kind: "sink_wrap", priority: 80 }],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger);
    expect(result.code).toContain('import { t } from "zintl";');
    expect(result.code).toContain('console.log("New");');
  });
});
