/**
 * Custody over a hot-update event (`docs/spec/ZDB.md` §3, `build/hmr`).
 *
 * The hot-update hook runs once *per environment*, and the bundler's watcher is
 * unqueued, so one filesystem change can reach the compiler several times and
 * several changes can reach it concurrently. These assert that the compiler-side
 * work happens once per event and that an older event cannot undo a newer one.
 */
import { describe, it, expect, vi } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";

function makeCompiler() {
  return new ZintlCompiler(
    { capabilities: emptyCapabilities(), locales: ["en", "ar"], sourceLocale: "en" } as never,
    "/tmp/zintl-delivery-test",
    true,
  );
}

describe("build/hmr custody", () => {
  it("invalidates once when several environments report the same event", async () => {
    // A client pass and an SSR pass for one file change carry the same
    // timestamp. Both need their own module graph invalidated, but the
    // compiler-side work must happen once — running it twice bumped the
    // boundary revision twice and raced two re-extractions of the same file.
    const compiler = makeCompiler();
    const spy = vi.spyOn(compiler, "invalidateFile").mockResolvedValue(["b1"]);

    const [client, ssr] = await Promise.all([
      compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/App.tsx", 1000),
      compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/App.tsx", 1000),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    // The joining pass gets the first pass's answer, not an empty list — it
    // still has modules to invalidate and needs to know which boundaries moved.
    expect(client).toEqual(["b1"]);
    expect(ssr).toEqual(["b1"]);
  });

  it("still processes an event that arrives out of order, and says so", async () => {
    /**
     * Invalidation **accumulates**; it does not replace. Discarding an event
     * because a higher sequence was already seen throws away work — marking
     * boundaries dirty, clearing caches, re-extracting — that no later event
     * will redo, and the update it would have produced is never emitted.
     *
     * Doing exactly that regressed `hmr-hammer` from 0 failures in 17 runs to 2
     * in 17, with the signature the proposal records: one fewer packet than
     * there were writes. Ordering belongs downstream, where a catalog really
     * does replace its predecessor.
     */
    const compiler = makeCompiler();
    const spy = vi.spyOn(compiler, "invalidateFile").mockResolvedValue(["b1"]);

    await compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/App.tsx", 2000);
    const late = await compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/App.tsx", 1000);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(late).toEqual(["b1"]);

    const outcomes = compiler.bus.history("build/hmr");
    expect(outcomes.map((e) => e.outcome)).toEqual(["applied", "applied"]);
    // The out-of-order arrival is still named, so it is diagnosable.
    expect(outcomes[1]?.reason).toContain("out of order");
  });

  it("orders per file, so one file's update cannot silence another's", async () => {
    const compiler = makeCompiler();
    const spy = vi.spyOn(compiler, "invalidateFile").mockResolvedValue(["b1"]);

    await compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/A.tsx", 9000);
    await compiler.invalidateForUpdate("/tmp/zintl-delivery-test/src/B.tsx", 1);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("passes the content the caller was handed straight through", async () => {
    // Re-reading from disk is what let a later write become a no-op: two
    // concurrent invalidations both read whatever was on disk at that moment,
    // so the earlier one observed the later content and the later one found
    // nothing to emit.
    const compiler = makeCompiler();
    const spy = vi.spyOn(compiler, "invalidateFile").mockResolvedValue([]);

    await compiler.invalidateForUpdate(
      "/tmp/zintl-delivery-test/src/App.tsx",
      1,
      false,
      "const a = 1;",
    );

    expect(spy).toHaveBeenCalledWith("/tmp/zintl-delivery-test/src/App.tsx", false, "const a = 1;");
  });

  it("names an update the self-write guard swallowed", async () => {
    // The guard stops the compiler's own catalog writes from re-triggering it,
    // but it is a time window, so a genuine edit landing inside one is dropped.
    // Naming it does not fix the window — it makes the loss visible.
    const compiler = makeCompiler();
    const path = "/tmp/zintl-delivery-test/zintl/ar/main.json";
    compiler.io.writingFiles.add(path);

    expect(await compiler.invalidateFile(path)).toEqual([]);
    expect(compiler.bus.history("io/write")).toContainEqual(
      expect.objectContaining({ outcome: "failed", reason: "suppressed by the self-write guard" }),
    );
  });
});
