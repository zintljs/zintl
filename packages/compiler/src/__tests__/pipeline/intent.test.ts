import { describe, it, expect } from "vite-plus/test";
import { formIntent } from "../../pipeline/intent.js";
import type { FileObservation, WorldState, ZintlConfig } from "../../pipeline/types.js";

const mockConfig: ZintlConfig = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "locales",
  isDev: false,
  root: "/root",
};

const createMockWorld = (overrides: Partial<WorldState> = {}): WorldState => ({
  manifest: {},
  dependencyGraph: {},
  metadataGraph: {},
  boundaryGraph: { nodes: new Map(), entries: new Set() },
  chunkGraph: {
    chunks: new Map(),
    entryChunks: new Map(),
    lazyChunks: new Set(),
    sharedChunks: new Set(),
    boundaryToOwner: new Map(),
  },
  config: mockConfig,
  catalogs: {},
  logger: console as any,
  ...overrides,
});

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

describe("Pipeline Phase 2: formIntent()", () => {
  describe("Decision Engine (Bake vs Wrap vs Passthrough)", () => {
    it("should produce SinkWrapIntent in development mode", () => {
      const world = createMockWorld({ config: { ...mockConfig, isDev: true } });
      const obs = createMockObs({
        sinks: [
          {
            text: "Submit",
            rawText: "Submit",
            sinkType: "button",
            location: { start: 10, end: 16, line: 1, column: 10 },
            boundaryId: "test",
            variables: [],
            isFragment: false,
          },
        ],
        anchors: [
          {
            location: { start: 0, end: 5, line: 1, column: 0 },
            scope: "module",
            boundaryId: "test",
            locale: { type: "literal", value: "en" },
            isTopLevel: true,
            originalName: "zintl",
          },
        ],
      });

      const intents = formIntent(obs, world);
      const wrap = intents.find((i) => i.type === "sink_wrap");
      expect(wrap).toBeDefined();
    });

    it("should produce SourceLocalePassthroughIntent in production when locale matches source", () => {
      const world = createMockWorld({ config: { ...mockConfig, isDev: false } });
      const obs = createMockObs({
        sinks: [
          {
            text: "Submit",
            rawText: "Submit",
            sinkType: "button",
            location: { start: 10, end: 16, line: 1, column: 10 },
            boundaryId: "test",
            variables: [],
            isFragment: false,
          },
        ],
        anchors: [
          {
            location: { start: 0, end: 5, line: 1, column: 0 },
            scope: "module",
            boundaryId: "test",
            locale: { type: "literal", value: "en" },
            isTopLevel: true,
            originalName: "zintl",
          },
        ],
      });

      const intents = formIntent(obs, world);
      const pass = intents.find((i) => i.type === "source_locale_passthrough");
      expect(pass).toBeDefined();
    });

    it("should produce BakingIntent in production when translation is available", () => {
      const world = createMockWorld({
        config: { ...mockConfig, isDev: false },
        catalogs: {
          test: { Submit: "إرسال" },
        },
      });
      const obs = createMockObs({
        sinks: [
          {
            text: "Submit",
            rawText: "Submit",
            sinkType: "button",
            location: { start: 10, end: 16, line: 1, column: 10 },
            boundaryId: "test",
            variables: [],
            isFragment: false,
          },
        ],
        anchors: [
          {
            location: { start: 0, end: 5, line: 1, column: 0 },
            scope: "module",
            boundaryId: "test",
            locale: { type: "literal", value: "ar" },
            isTopLevel: true,
            originalName: "zintl",
          },
        ],
      });

      const intents = formIntent(obs, world);
      const bake = intents.find((i) => i.type === "baking") as any;
      expect(bake).toBeDefined();
      expect(bake.translation).toBe("إرسال");
    });
  });

  describe("Dependency & Manager Planning", () => {
    it("should plan necessary runtime imports", () => {
      const world = createMockWorld({ config: { ...mockConfig, isDev: true } });
      const obs = createMockObs({
        sinks: [
          {
            text: "Submit",
            rawText: "Submit",
            sinkType: "button",
            location: { start: 0, end: 0, line: 0, column: 0 },
            boundaryId: "test",
            variables: [],
            isFragment: false,
          },
        ],
      });

      const intents = formIntent(obs, world);
      const wrap = intents.find((i) => i.type === "sink_wrap");
      expect(wrap).toBeDefined();

      // Imports are now handled in Phase 3 (Resolve)
      const imp = intents.find((i) => i.type === "import");
      expect(imp).toBeUndefined();
    });

    it("should plan anchor handshakes via loadI18nInstance", () => {
      const world = createMockWorld();
      const obs = createMockObs({
        anchors: [
          {
            location: { start: 0, end: 0, line: 0, column: 0 },
            scope: "module",
            boundaryId: "test",
            locale: { type: "literal", value: "en" },
            isTopLevel: true,
            originalName: "zintl",
          },
        ],
      });

      const intents = formIntent(obs, world);
      const rewrite = intents.find((i) => i.type === "marker_removal") as any;
      expect(rewrite).toBeDefined();
      expect(rewrite.replacement).toBe("");

      // Imports are now handled in Phase 3 (Resolve)
      const imp = intents.find((i) => i.type === "import");
      expect(imp).toBeUndefined();
    });
  });
});
