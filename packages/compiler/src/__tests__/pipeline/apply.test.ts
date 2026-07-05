import { describe, it, expect } from "vite-plus/test";
import { apply } from "../../pipeline/apply.js";
import {
  resolveFacets,
  vueExtractionFacet,
  vueCodegenFacet,
  svelteExtractionFacet,
  svelteCodegenFacet,
} from "../../facet/index.js";
import MagicString from "magic-string";
import type { ResolvedPlan } from "../../pipeline/types.js";

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

const { capabilities, system, facets } = resolveFacets([
  vueExtractionFacet,
  vueCodegenFacet,
  svelteExtractionFacet,
  svelteCodegenFacet,
]);

const mockConfig = {
  sourceLocale: "en",
  locales: ["en"],
  outputDir: "locales",
  isDev: true,
  root: "/root",
  facets,
  capabilities,
  system,
};

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

  it("should handle Vue SFC with existing setup script", () => {
    const source = `<script setup lang="ts">\nconsole.log("Existing");\n</script>\n<div>Hello</div>`;
    const plan: ResolvedPlan = {
      prepends: [{ code: `const a = 1;` }],
      imports: [{ source: "zintl", specifiers: ["t"], strategy: "new" }],
      rewrites: [],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger, "Component.vue", mockConfig);
    expect(result.code).toContain(
      '<script setup lang="ts">\nconst a = 1;\nimport { t } from "zintl";',
    );
  });

  it("should handle replace strategy when start === end in imports", () => {
    const source = `console.log("hi");`;
    const plan: ResolvedPlan = {
      prepends: [],
      imports: [
        {
          source: "zintl",
          specifiers: ["t"],
          strategy: "replace",
          location: {
            start: 0,
            end: 0,
            line: 1,
            column: 0,
          },
        },
      ],
      rewrites: [],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger);
    expect(result.code).toBe('import { t } from "zintl";console.log("hi");');
  });

  it("should handle merge strategy and insert space when trimmedBefore matches contentBeforeBrace", () => {
    const source = `import {zintl} from "zintl";`;
    const plan: ResolvedPlan = {
      prepends: [],
      imports: [
        {
          source: "zintl",
          specifiers: ["t"],
          strategy: "merge",
          location: {
            start: 0,
            end: source.length,
            line: 1,
            column: 0,
          },
        },
      ],
      rewrites: [],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger);
    // Should append space at closing brace
    expect(result.code).toBe('import {zintl, t } from "zintl";');
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

  it("should inject script wrapper in Vue/Svelte SFCs if missing", () => {
    const vueSource = `<div>Hello</div>`;
    const svelteSource = `<div>Hello Svelte</div>`;

    const plan: ResolvedPlan = {
      prepends: [{ code: `const a = 1;` }],
      imports: [{ source: "zintl", specifiers: ["t"], strategy: "new" }],
      rewrites: [],
      diagnostics: [],
    };

    const vueResult = apply(vueSource, plan, mockLogger, "Component.vue", mockConfig);
    expect(vueResult.code).toContain('<script setup lang="ts">');
    expect(vueResult.code).toContain("const a = 1;");
    expect(vueResult.code).toContain('import { t } from "zintl";');
    expect(vueResult.code).toContain("</script>");

    const svelteResult = apply(svelteSource, plan, mockLogger, "Component.svelte", mockConfig);
    expect(svelteResult.code).toContain("<script>");
    expect(svelteResult.code).toContain("const a = 1;");
    expect(svelteResult.code).toContain('import { t } from "zintl";');
    expect(svelteResult.code).toContain("</script>");
  });

  it("should handle merge strategy when closing brace is missing in location", () => {
    const source = `import * as z from "zintl";`;
    const plan: ResolvedPlan = {
      prepends: [],
      imports: [
        {
          source: "zintl",
          specifiers: ["t"],
          strategy: "merge",
          location: {
            start: 0,
            end: source.length,
            line: 1,
            column: 0,
          },
        },
      ],
      rewrites: [],
      diagnostics: [],
    };

    const result = apply(source, plan, mockLogger);
    expect(result.code).toContain('import { t } from "zintl";');
  });

  it("should catch and throw MagicString exceptions gracefully in imports and rewrites", () => {
    const source = `console.log("test");`;

    // 1. Invalid imports overwrite
    const planImportsErr: ResolvedPlan = {
      prepends: [],
      imports: [
        {
          source: "zintl",
          specifiers: ["t"],
          strategy: "replace",
          location: {
            start: 100, // out of bounds
            end: 200,
            line: 1,
            column: 0,
          },
        },
      ],
      rewrites: [],
      diagnostics: [],
    };
    expect(() => apply(source, planImportsErr, mockLogger)).toThrow();

    // 2. Invalid rewrite appendLeft
    const planRewritesErr1: ResolvedPlan = {
      prepends: [],
      imports: [],
      rewrites: [
        {
          start: 10,
          end: 10,
          replacement: "oops",
          kind: "sink_wrap",
          priority: 1,
        },
      ],
      diagnostics: [],
    };

    // oxlint-disable-next-line typescript/unbound-method
    const origAppendLeft = MagicString.prototype.appendLeft;
    MagicString.prototype.appendLeft = () => {
      throw new Error("Mocked appendLeft error");
    };
    try {
      expect(() => apply(source, planRewritesErr1, mockLogger)).toThrow();
    } finally {
      MagicString.prototype.appendLeft = origAppendLeft;
    }

    // 3. Invalid rewrite overwrite
    const planRewritesErr2: ResolvedPlan = {
      prepends: [],
      imports: [],
      rewrites: [
        {
          start: 10,
          end: 15,
          replacement: "oops",
          kind: "sink_wrap",
          priority: 1,
        },
      ],
      diagnostics: [],
    };

    // oxlint-disable-next-line typescript/unbound-method
    const origOverwrite = MagicString.prototype.overwrite;
    MagicString.prototype.overwrite = () => {
      throw new Error("Mocked overwrite error");
    };
    try {
      expect(() => apply(source, planRewritesErr2, mockLogger)).toThrow();
    } finally {
      MagicString.prototype.overwrite = origOverwrite;
    }
  });
});
