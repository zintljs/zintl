import { describe, it, expect } from "vite-plus/test";
import { validate } from "../../pipeline/validate.js";
import type { TransformResult, FileObservation, ResolvedPlan } from "../../pipeline/types.js";

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

const createMockObs = (overrides: Partial<FileObservation> = {}): FileObservation => ({
  sinks: [],
  manualTranslations: [],
  anchors: [],
  imports: [],
  dependencies: [],
  boundaries: [],
  directives: [],
  fileId: "test",
  hasZintlMarker: false,
  hasZintlMacro: false,
  contentHash: "hash",
  existingRuntimeImports: [],
  exportedBoundaries: {},
  internalDependencies: {},
  ...overrides,
});

describe("Pipeline Phase 5: validate()", () => {
  it("should pass for valid transformed code", () => {
    const result: TransformResult = {
      code: `import { t } from "zintl";\nt("msg");`,
      diagnostics: [],
      map: {},
    };
    const plan: ResolvedPlan = {
      imports: [{ source: "zintl", specifiers: ["t"], strategy: "merge" }],
      prepends: [],
      rewrites: [],
      diagnostics: [],
    };

    const vResult = validate(result, plan, createMockObs(), mockLogger);
    expect(vResult.valid).toBe(true);
    expect(vResult.errors).toHaveLength(0);
  });

  it("should fail if t() is present in plan and used in rewrite, but missing from output", () => {
    const result: TransformResult = {
      code: `ok`,
      diagnostics: [],
      map: {},
    };
    const plan: ResolvedPlan = {
      imports: [{ source: "zintl", specifiers: ["_t"], strategy: "new" }],
      prepends: [],
      rewrites: [{ kind: "manual_t", start: 0, end: 2, replacement: '_t("msg")' } as any],
      diagnostics: [],
    };

    const vResult = validate(result, plan, createMockObs(), mockLogger);
    expect(vResult.valid).toBe(false);
    expect(vResult.errors[0].type).toBe("missing_import");
  });

  it("should fail if zintl() stray call is detected", () => {
    const result: TransformResult = {
      code: `import { t } from "zintl";\nzintl("en");`,
      diagnostics: [],
      map: {},
    };

    const vResult = validate(
      result,
      { imports: [], prepends: [], rewrites: [], diagnostics: [] },
      createMockObs(),
      mockLogger,
    );
    expect(vResult.valid).toBe(false);
    expect(vResult.errors[0].type).toBe("stray_marker");
  });
});
