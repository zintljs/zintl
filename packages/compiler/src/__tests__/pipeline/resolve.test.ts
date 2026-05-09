import { describe, it, expect } from "vite-plus/test";
import { resolve } from "../../pipeline/resolve.js";
import type { FileObservation, TransformIntent } from "../../pipeline/types.js";

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

const mockConfig = { isDev: true, sourceLocale: "en", locales: ["en"] } as any;
const mockLogger = { debug: () => {}, withPrefix: () => mockLogger } as any;

describe("Pipeline Phase 3: resolve()", () => {
  describe("Conflict Resolution & Priority", () => {
    it("should allow bake to override wrap on same range", () => {
      const loc = { start: 10, end: 20, line: 1, column: 10 };
      const intents: TransformIntent[] = [
        {
          type: "sink_wrap",
          sink: {
            text: "Submit",
            rawText: "Submit",
            location: loc,
            boundaryId: "b1",
            variables: [],
            isFragment: false,
          } as any,
          messageId: "msg1",
          boundaryId: "b1",
          ownerId: "root",
          safeId: "hash1",
          isDev: false,
        },
        {
          type: "baking",
          sink: {
            text: "Submit",
            rawText: "Submit",
            location: loc,
            boundaryId: "b1",
            variables: [],
            isFragment: false,
          } as any,
          messageId: "msg1",
          translation: "إرسال",
          variables: [],
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      expect(plan.rewrites[0].kind).toBe("bake");
      expect(plan.rewrites[0].replacement).toBe('"إرسال"');
    });

    it("should preserve both if they don't overlap", () => {
      const intents: TransformIntent[] = [
        {
          type: "sink_wrap",
          sink: {
            text: "A",
            location: { start: 0, end: 5, line: 1, column: 0 },
            boundaryId: "b",
            variables: [],
            isFragment: false,
          } as any,
          messageId: "msgA",
          boundaryId: "b",
          ownerId: "root",
          safeId: "hash",
          isDev: false,
        },
        {
          type: "sink_wrap",
          sink: {
            text: "B",
            location: { start: 10, end: 15, line: 1, column: 10 },
            boundaryId: "b",
            variables: [],
            isFragment: false,
          } as any,
          messageId: "msgB",
          boundaryId: "b",
          ownerId: "root",
          safeId: "hash",
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(2);
    });
  });

  describe("Baking Logic (Code Generation)", () => {
    it("should generate template literal for interpolation", () => {
      const intents: TransformIntent[] = [
        {
          type: "baking",
          sink: {
            text: "Hello {name}",
            rawText: "Hello {name}",
            location: { start: 0, end: 5 },
            boundaryId: "b",
            variables: [],
          } as any,
          messageId: "m",
          translation: "مرحباً {name}",
          variables: [{ name: "name", expr: "user.name" }],
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      expect(plan.rewrites[0].replacement).toBe("`مرحباً ${user.name}`");
    });

    it("should generate nested ternary for conditionals", () => {
      const intents: TransformIntent[] = [
        {
          type: "baking",
          sink: {
            text: "{n}",
            location: { start: 0, end: 5 },
            boundaryId: "b",
            variables: [],
          } as any,
          messageId: "m",
          translation: {
            "n = 1": "واحد",
            "n > 1": "كثير",
          },
          variables: [{ name: "n", expr: "count" }],
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      const code = plan.rewrites[0].replacement;
      expect(code).toContain("count == 1");
      expect(code).toContain("? `واحد` :");
      expect(code).toContain("count > 1");
      expect(code).toContain("? `كثير` :");
    });
    it("should bake debug flag into loadI18nInstance if enabled", () => {
      const intents: TransformIntent[] = [
        {
          type: "anchor_rewrite",
          location: { start: 0, end: 10, line: 1, column: 0 },
          locale: { type: "literal", value: "en" },
          loaders: [],
          boundaryId: "test",
          originalName: "zintl",
        },
      ];

      const debugConfig = { ...mockConfig, debug: true };
      const plan = resolve(intents, createMockObs(), debugConfig, mockLogger);
      expect(plan.rewrites[0].replacement).toContain("debug: true");
    });
  });

  describe("Import Consolidation", () => {
    it("should merge multiple import intents for the same source", () => {
      const intents: TransformIntent[] = [
        { type: "import", source: "zintl", specifiers: ["t"], strategy: "merge" },
        { type: "import", source: "zintl", specifiers: ["loadI18nInstance"], strategy: "merge" },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.imports).toHaveLength(1);
      expect(plan.imports[0].specifiers).toContain("t");
      expect(plan.imports[0].specifiers).toContain("loadI18nInstance");
    });
  });

  describe("Ordering Invariant", () => {
    it("should sort rewrites in descending order by start position", () => {
      const intents = [
        {
          type: "sink_wrap",
          sink: { location: { start: 0, end: 5 } } as any,
          messageId: "1",
          safeId: "h",
          boundaryId: "b",
          isDev: false,
        },
        {
          type: "sink_wrap",
          sink: { location: { start: 20, end: 25 } } as any,
          messageId: "2",
          safeId: "h",
          boundaryId: "b",
          isDev: false,
        },
        {
          type: "sink_wrap",
          sink: { location: { start: 10, end: 15 } } as any,
          messageId: "3",
          safeId: "h",
          boundaryId: "b",
          isDev: false,
        },
      ] as TransformIntent[];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites[0].start).toBe(20);
      expect(plan.rewrites[1].start).toBe(10);
      expect(plan.rewrites[2].start).toBe(0);
    });
  });

  describe("Manual t() Rewrite", () => {
    it("should preserve paramsSource in rewritten _t call", () => {
      const intents: TransformIntent[] = [
        {
          type: "manual_t_rewrite",
          location: { start: 10, end: 30, line: 1, column: 10 },
          originalKey: "ICU {count}",
          messageId: "msg_hash",
          boundaryId: "b1",
          ownerId: "root",
          safeId: "root_safe",
          paramsSource: "{ count: 5 }",
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      expect(plan.rewrites[0].kind).toBe("manual_t");
      expect(plan.rewrites[0].replacement).toBe(
        '_t("msg_hash", { count: 5 }, { _mgr: _zintl_mgr_root_safe, _bId: "b1" })',
      );
    });

    it("should work without paramsSource", () => {
      const intents: TransformIntent[] = [
        {
          type: "manual_t_rewrite",
          location: { start: 10, end: 30, line: 1, column: 10 },
          originalKey: "Flat",
          messageId: "msg_hash",
          boundaryId: "b1",
          ownerId: "root",
          safeId: "root_safe",
          paramsSource: undefined,
          isDev: false,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      expect(plan.rewrites[0].replacement).toBe(
        '_t("msg_hash", { _mgr: _zintl_mgr_root_safe, _bId: "b1" })',
      );
    });

    it("should use original key in development mode", () => {
      const intents: TransformIntent[] = [
        {
          type: "manual_t_rewrite",
          location: { start: 10, end: 30, line: 1, column: 10 },
          originalKey: "DevKey",
          messageId: "msg123",
          boundaryId: "b1",
          ownerId: "root",
          safeId: "root_safe",
          paramsSource: undefined,
          isDev: true,
        },
      ];

      const plan = resolve(intents, createMockObs(), mockConfig, mockLogger);
      expect(plan.rewrites).toHaveLength(1);
      expect(plan.rewrites[0].replacement).toBe(
        '_t("DevKey", { _mgr: _zintl_mgr_root_safe, _bId: "b1" })',
      );
    });
  });

  describe("Zero-Width Import Handling", () => {
    it("should skip replacing zero-width shadow imports to avoid apply-phase crashes", () => {
      const observation = createMockObs({
        imports: [
          {
            source: "zintl",
            specifiers: [{ local: "t", imported: "t", kind: "value" }],
            location: { start: 10, end: 30, line: 1, column: 10 },
            isDynamic: false,
          },
          {
            source: "zintl",
            specifiers: [],
            location: { start: 50, end: 50, line: 10, column: 0 },
            isDynamic: false,
          },
        ],
      });

      const intents: TransformIntent[] = [
        { type: "import", source: "zintl", specifiers: ["_t"], strategy: "replace" },
      ];

      const plan = resolve(intents, observation, mockConfig, mockLogger);

      // Should have 1 import (the primary being replaced)
      // The second one (zero-width) should be skipped by the consolidation guard
      expect(plan.imports).toHaveLength(1);
      expect(plan.imports[0].strategy).toBe("replace");
      expect(plan.imports[0].location?.start).toBe(10);
    });
  });
});
