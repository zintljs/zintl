/**
 * ZRS Axiom 4 — ownership is deterministic regardless of enumeration order.
 *
 * The axiom exists so that builds are reproducible "regardless of file system
 * enumeration order". It was written down and not applied where it mattered
 * most: `computeTranslationChunks` assigns ownership by walking each root's
 * static tree and keeping whichever root got there first, so the iteration
 * order of the root set decided who owned anything two roots could reach.
 *
 * That order came from the graph's insertion order, which differs between a
 * compiler starting cold and one reading a saved manifest — the manifest is
 * written with sorted keys. The same source therefore produced two different
 * graphs depending on whether a previous build had run.
 */
import { describe, it, expect } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";
import type { Boundary, BoundaryGraph, BoundaryMetadata } from "../../types/graph.js";

function compiler() {
  return new ZintlCompiler(
    { capabilities: emptyCapabilities(), locales: ["en", "ar"], sourceLocale: "en" } as never,
    "/tmp/zintl-ownership-test",
    false,
  );
}

function node(id: string, deps: string[], mode: Boundary["mode"] = "boundary"): Boundary {
  return {
    id,
    mode,
    deps: deps.map((d) => ({ id: d, dynamic: false, bindings: [] }) as never),
    usageCount: 0,
    filePath: id.split(":")[0],
    activeLocales: "all",
  };
}

function anchoredFile(): BoundaryMetadata {
  return {
    hasZintlMacro: true,
    hasZintlMarker: false,
    isEntry: false,
    // Nested functional anchors: no top-level anchor, so each owning function
    // becomes its own root (ZRS Axiom 5).
    anchorSites: [{ isTopLevel: false }] as never,
    needsLoader: true,
    exportedBoundaries: {},
    internalDependencies: {},
  };
}

/**
 * Two roots in one file, both statically reaching one shared boundary — the
 * `react-basic` shape, where `main.tsx` holds both `bootstrap` and an anonymous
 * arrow function and both reach `App`.
 */
function graphWithRootsInOrder(first: string, second: string): BoundaryGraph {
  const shared = "src/App.tsx:App";
  return {
    nodes: new Map([
      [first, node(first, [shared], "entry")],
      [second, node(second, [shared], "entry")],
      [shared, node(shared, [])],
    ]),
    entries: new Set([first, second]),
  };
}

const BOOTSTRAP = "src/main.tsx:bootstrap";
const ANON = "src/main.tsx:f_547";
const SHARED = "src/App.tsx:App";

function ownerOfShared(entriesInsertedAs: [string, string]): string | undefined {
  const c = compiler();
  const graph = graphWithRootsInOrder(...entriesInsertedAs);
  const manifest = {
    [BOOTSTRAP]: [{ text: "x" }],
    [ANON]: [{ text: "y" }],
    [SHARED]: [{ text: "z" }],
  } as never;
  const metadata = {
    "src/main.tsx": anchoredFile(),
    "src/App.tsx": anchoredFile(),
  } as never;

  const chunks = c.graph.computeTranslationChunks(graph, manifest, metadata, []);
  return chunks.boundaryToOwner.get(SHARED);
}

describe("ZRS Axiom 4 — deterministic ownership", () => {
  it("assigns the same owner whichever order the roots were discovered in", () => {
    /**
     * This is the regression. Before roots were sorted, feeding the same two
     * entries in the other order handed ownership to the other root — which is
     * what made a cold compile disagree with a warm one.
     */
    const discoveryOrder = ownerOfShared([BOOTSTRAP, ANON]);
    const reverseOrder = ownerOfShared([ANON, BOOTSTRAP]);

    expect(discoveryOrder).toBe(reverseOrder);
  });

  it("resolves the tie lexicographically, as the axiom specifies", () => {
    // "bootstrap" < "f_547", so the named function owns the shared boundary
    // whichever order the graph happened to be built in.
    expect(ownerOfShared([ANON, BOOTSTRAP])).toBe(BOOTSTRAP);
    expect(ownerOfShared([BOOTSTRAP, ANON])).toBe(BOOTSTRAP);
  });
});
