/**
 * Forgetting a deleted file.
 *
 * The compiler had no path for this at all: the bundler routes `unlink`
 * separately from `change` and never calls `handleHotUpdate`/`hotUpdate`, and
 * the plugin registered no watcher of its own. A deleted boundary stayed in the
 * graph and the manifest for the life of the process.
 *
 * That is worse than stale state, because dev servers are pooled: the orphan
 * outlived the thing that created it. In the contract suite it leaked into every
 * later contract's graph snapshot, and through the shared compiler manifest it
 * reached the committed examples — twelve generated JSON files describing source
 * that no longer existed.
 */
import { describe, it, expect } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";

function makeCompiler() {
  const compiler = new ZintlCompiler(
    { capabilities: emptyCapabilities(), locales: ["en", "ar"], sourceLocale: "en" } as never,
    "/tmp/zintl-removal-test",
    true,
  );

  // A file the compiler knows about, owning one boundary.
  compiler.messages.boundaryOwnership.set("src/Gone.tsx", new Set(["src/Gone.tsx:Gone"]));
  compiler.messages.internalManifest["src/Gone.tsx:Gone"] = [{ text: "Hello" }] as never;
  compiler.messages.metadataGraph["src/Gone.tsx"] = { isEntry: false } as never;
  compiler.messages.dependencyGraph["src/Gone.tsx"] = [] as never;

  return compiler;
}

describe("removeFile", () => {
  it("forgets the boundaries a deleted file owned", async () => {
    const compiler = makeCompiler();

    const removed = await compiler.removeFile("/tmp/zintl-removal-test/src/Gone.tsx");

    expect(removed).toEqual(["src/Gone.tsx:Gone"]);
    expect(compiler.messages.internalManifest["src/Gone.tsx:Gone"]).toBeUndefined();
    expect(compiler.messages.boundaryOwnership.has("src/Gone.tsx")).toBe(false);
    expect(compiler.messages.metadataGraph["src/Gone.tsx"]).toBeUndefined();
    expect(compiler.messages.dependencyGraph["src/Gone.tsx"]).toBeUndefined();
  });

  it("leaves the removed boundaries out of the dirty set, so nothing rewrites them", async () => {
    /**
     * This asserted the opposite — that removal marks the boundary dirty "so a
     * flush reclaims their catalogs" — and the intent behind it was sound while
     * the mechanism was backwards. Pruning does find orphans by comparing the
     * output directory against the live graph, and a deletion during an idle
     * moment must not sit unflushed. But "dirty" does not mean *reclaim me*, it
     * means **write my catalog**, so the flag queued the deleted boundary's
     * catalogs to be written straight back after the prune had removed them:
     *
     * ```
     * Pruning orphaned file: zintl/src/App.svelte.ar.json   +0ms
     * Writing file:          zintl/src/App.svelte.ar.json   +0ms
     * ```
     *
     * Ledger L-071. The waking the flag was really for is already handled twice
     * over — `removeFile` ends with an explicit `scheduleFlush()`, and a flush
     * deferred by another gets its own trigger (L-070) — so removing it costs
     * nothing that was wanted.
     */
    const compiler = makeCompiler();

    await compiler.removeFile("/tmp/zintl-removal-test/src/Gone.tsx");

    expect([...compiler.messages.dirtyBoundaries]).not.toContain("src/Gone.tsx:Gone");
  });

  it("names the deletion in the ledger", async () => {
    const compiler = makeCompiler();

    await compiler.removeFile("/tmp/zintl-removal-test/src/Gone.tsx");

    expect(compiler.bus.history("build/hmr")).toContainEqual(
      expect.objectContaining({ subject: "src/Gone.tsx", outcome: "applied" }),
    );
  });

  it("ignores a file it never knew about", async () => {
    // Stylesheets, assets, anything outside the boundary graph. Deleting one is
    // not an event the compiler has any state to reconcile.
    const compiler = makeCompiler();

    expect(await compiler.removeFile("/tmp/zintl-removal-test/src/theme.css")).toEqual([]);
    // And it must not disturb what it does know.
    expect(compiler.messages.internalManifest["src/Gone.tsx:Gone"]).toBeDefined();
  });
});
