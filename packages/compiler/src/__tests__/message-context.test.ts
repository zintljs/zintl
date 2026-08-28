/**
 * Derived translator context (proposal 032 §3).
 *
 * The claim under test is that everything a translator needs and no TMS can
 * compute is already sitting in the graphs — which screens a string reaches,
 * how many boundaries share it, what expression produced `{input}` — and that
 * reading it is a pure function of state rather than a pipeline stage.
 *
 * Graphs are built by hand here, which is the point of the module being pure.
 * The interesting cases are structural — an entry that reaches one boundary and
 * not another, one string in four places, a boundary whose metadata is gone —
 * and stating them directly is both shorter and more precise than coaxing them
 * out of real source.
 */
import { describe, it, expect } from "vite-plus/test";
import { deriveMessageContext, type MessageContextWorld } from "../message-context.js";
import type { ManifestEntry } from "../reconcile.js";
import type { BoundaryGraph, ChunkGraph, MetadataGraph } from "../types/graph.js";
import type { ObservedSink } from "../types/observation.js";

const at = (start: number) => ({ start, end: start + 10, line: 1, column: 0 });

function entry(
  text: string,
  boundaryId: string,
  start: number,
  extra: Partial<ManifestEntry> = {},
) {
  return { id: `id_${text}`, text, boundaryId, location: at(start), ...extra } as ManifestEntry;
}

function sink(text: string, boundaryId: string, start: number, extra: Partial<ObservedSink> = {}) {
  return {
    text,
    rawText: text,
    boundaryId,
    sinkType: "HTML_TEXT",
    location: at(start),
    variables: [],
    isFragment: false,
    ...extra,
  } as ObservedSink;
}

/** A world with nothing in it, so each test declares only what it is about. */
function world(over: Partial<MessageContextWorld> = {}): MessageContextWorld {
  return {
    manifest: {},
    metadataGraph: {} as MetadataGraph,
    boundaryGraph: null,
    chunkGraph: null,
    ...over,
  };
}

describe("deriveMessageContext", () => {
  it("returns null for a string the boundary does not carry", () => {
    const w = world({ manifest: { "src/a": [entry("Save", "src/a", 0)] } });
    expect(deriveMessageContext("src/a", "Cancel", w)).toBeNull();
    expect(deriveMessageContext("src/nowhere", "Save", w)).toBeNull();
  });

  /**
   * One string reached two ways is one message with two occurrences — never one
   * occurrence with a merged context. Unioning here would throw away the fact
   * that the translator's single string is doing two different jobs.
   */
  it("reports one occurrence per sink, not one per string", () => {
    const w = world({
      manifest: {
        "src/a": [
          entry("Open", "src/a", 0, { context: "alt" }),
          entry("Open", "src/a", 40, { context: "title" }),
        ],
      },
    });

    const ctx = deriveMessageContext("src/a", "Open", w)!;
    expect(ctx.occurrences).toHaveLength(2);
    expect(ctx.occurrences.map((o) => o.context)).toEqual(["alt", "title"]);
  });

  /**
   * `{input}` alone is unanswerable; `user.firstName` is not. The expressions
   * live on the sink rather than in the manifest, so this is also the test that
   * the two are correctly paired.
   */
  it("carries the expression behind each placeholder", () => {
    const w = world({
      manifest: { "src/a": [entry("Hello {name}", "src/a", 0)] },
      metadataGraph: {
        "src/a": {
          sinks: [
            sink("Hello {name}", "src/a", 0, {
              variables: [
                {
                  name: "name",
                  originalName: "name",
                  expression: "user.firstName",
                  sourceRange: at(3),
                },
              ],
            }),
          ],
        },
      } as unknown as MetadataGraph,
    });

    const ctx = deriveMessageContext("src/a", "Hello {name}", w)!;
    expect(ctx.occurrences[0].variables).toEqual([{ name: "name", expression: "user.firstName" }]);
  });

  /**
   * Two identical strings in one boundary must not share the first one's
   * variables. Pairing by text would do exactly that, which is why the pairing
   * is positional.
   */
  it("pairs a sink to its own occurrence, not to a namesake", () => {
    const w = world({
      manifest: {
        "src/a": [entry("Open", "src/a", 0), entry("Open", "src/a", 40)],
      },
      metadataGraph: {
        "src/a": {
          sinks: [
            sink("Open", "src/a", 0, { note: "the verb" }),
            sink("Open", "src/a", 40, { note: "the adjective", isFragment: true }),
          ],
        },
      } as unknown as MetadataGraph,
    });

    const ctx = deriveMessageContext("src/a", "Open", w)!;
    expect(ctx.occurrences[0].isFragment).toBe(false);
    expect(ctx.occurrences[1].isFragment).toBe(true);
  });

  it("names every other boundary carrying the same string", () => {
    const w = world({
      manifest: {
        "src/a": [entry("Save", "src/a", 0)],
        "src/b": [entry("Save", "src/b", 0)],
        "src/c": [entry("Save", "src/c", 0)],
        "src/d": [entry("Cancel", "src/d", 0)],
      },
    });

    const ctx = deriveMessageContext("src/a", "Save", w)!;
    // Itself excluded — the question is what *else* an edit would change.
    expect(ctx.sharedWith).toEqual(["src/b", "src/c"]);
  });

  describe("screens", () => {
    const graph = {
      nodes: new Map(),
      entries: new Set(["src/checkout", "src/settings"]),
    } as unknown as BoundaryGraph;

    const reach: Record<string, string[]> = {
      "src/checkout": ["src/checkout", "src/shared"],
      "src/settings": ["src/settings"],
    };

    const w = world({
      manifest: { "src/shared": [entry("Save", "src/shared", 0)] },
      boundaryGraph: graph,
      reachableFrom: (id) => new Set(reach[id] ?? []),
    });

    it("lists only the entries that actually reach the boundary", () => {
      const ctx = deriveMessageContext("src/shared", "Save", w)!;
      expect(ctx.screens).toEqual(["src/checkout"]);
    });

    /**
     * A string on no screen is worth reporting rather than hiding: it ships for
     * nothing. Empty is an answer; absent would not be.
     */
    it("reports an empty list for a boundary no entry reaches", () => {
      const orphan = world({
        manifest: { "src/orphan": [entry("Save", "src/orphan", 0)] },
        boundaryGraph: graph,
        reachableFrom: (id) => new Set(reach[id] ?? []),
      });
      expect(deriveMessageContext("src/orphan", "Save", orphan)!.screens).toEqual([]);
    });
  });

  it("names the chunk the boundary loads in", () => {
    const w = world({
      manifest: { "src/a": [entry("Save", "src/a", 0)] },
      chunkGraph: {
        chunks: new Map([["lazy_b_1", { id: "lazy_b_1", type: "lazy" }]]),
        boundaryToOwner: new Map([["src/a", "lazy_b_1"]]),
      } as unknown as ChunkGraph,
    });

    expect(deriveMessageContext("src/a", "Save", w)!.chunk).toEqual({
      id: "lazy_b_1",
      type: "lazy",
    });
  });

  /**
   * The graphs are genuinely absent early in a dev session, and this is the one
   * API most wanted exactly then. Missing state degrades field by field.
   */
  describe("when the world is incomplete", () => {
    it("answers what it can with no graphs at all", () => {
      const w = world({ manifest: { "src/a": [entry("Save", "src/a", 0, { note: "a note" })] } });
      const ctx = deriveMessageContext("src/a", "Save", w)!;

      expect(ctx.occurrences[0].note).toBe("a note");
      expect(ctx.screens).toEqual([]);
      expect(ctx.chunk).toBeUndefined();
      expect(ctx.occurrences[0].variables).toBeUndefined();
    });

    it("survives a boundary whose metadata has been evicted", () => {
      const w = world({ manifest: { "src/a:render": [entry("Save", "src/a:render", 0)] } });
      expect(() => deriveMessageContext("src/a:render", "Save", w)).not.toThrow();
    });

    it("finds the sinks of a function-scoped boundary under its file", () => {
      const w = world({
        manifest: { "src/a:render": [entry("Save", "src/a:render", 0)] },
        metadataGraph: {
          "src/a": { sinks: [sink("Save", "src/a:render", 0, { note: "from the file" })] },
        } as unknown as MetadataGraph,
      });

      const ctx = deriveMessageContext("src/a:render", "Save", w)!;
      expect(ctx.occurrences[0].isFragment).toBe(false);
    });
  });
});
