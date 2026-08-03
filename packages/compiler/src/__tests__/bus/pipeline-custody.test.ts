/**
 * Custody over compiler stages (`docs/spec/ZDB.md` §3, `build/pipeline`).
 *
 * The flush and the graph rebuild are the compiler's own versions of the two
 * runtime defects: one collapsed concurrent callers onto a promise that did not
 * include their work, the other let whichever rebuild *finished* last decide the
 * world. Both are asserted here rather than left to a contract to notice.
 */
import { describe, it, expect, vi } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";

function makeCompiler() {
  return new ZintlCompiler(
    { capabilities: emptyCapabilities(), locales: ["en", "ar"], sourceLocale: "en" } as never,
    "/tmp/zintl-pipeline-test",
    true,
  );
}

/**
 * Replace the flush body, leaving the custody wrapper under test.
 *
 * The wrapper is the whole subject here — coalescing, the follow-on, and
 * clearing the cached promise — so the body it guards is deliberately stubbed.
 */
function stubRunFlush(compiler: ZintlCompiler, impl: () => Promise<void>) {
  return vi
    .spyOn(compiler as unknown as { runFlush: () => Promise<void> }, "runFlush")
    .mockImplementation(impl);
}

describe("flush custody", () => {
  it("recovers after a failing flush instead of poisoning every later one", async () => {
    /**
     * `flushPromise = null` used to be the last statement *inside* the async
     * body, so a single throw left a rejected promise cached and every
     * subsequent flush returned that same rejection — for the life of the
     * process. `verifyIntegrity` throws by design on a missing translation, and
     * the hot-update hook swallows the result with `.catch`, so a compiler could
     * stop flushing entirely and nothing would say so.
     */
    const compiler = makeCompiler();
    let attempt = 0;
    stubRunFlush(compiler, async () => {
      attempt++;
      if (attempt === 1) throw new Error("missing translation");
    });

    await expect(compiler.flush()).rejects.toThrow("missing translation");

    // The next flush must actually run, not replay the cached rejection.
    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it("names a failed flush", async () => {
    const compiler = makeCompiler();
    stubRunFlush(compiler, async () => {
      throw new Error("boom");
    });

    await expect(compiler.flush()).rejects.toThrow("boom");
    expect(compiler.bus.history("build/pipeline")).toContainEqual(
      expect.objectContaining({ subject: "flush", outcome: "failed" }),
    );
  });

  it("runs a follow-on for a caller whose work the in-flight run had not adopted", async () => {
    /**
     * Axiom D3. Handing the second caller the in-flight promise meant awaiting
     * it resolved to "someone else's work finished" — the running flush had
     * already snapshotted its dirty set before this caller's boundaries were
     * added to it, and then cleared the whole set on the way out.
     */
    const compiler = makeCompiler();
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));

    let runs = 0;
    stubRunFlush(compiler, async () => {
      runs++;
      if (runs === 1) {
        await first;
        // Adopted nothing; this boundary was dirtied after the snapshot.
        compiler.messages.dirtyBoundaries.add("b_late");
      } else {
        compiler.messages.dirtyBoundaries.clear();
      }
    });

    const a = compiler.flush();
    const b = compiler.flush();
    release();
    await Promise.all([a, b]);

    expect(runs).toBe(2);
    expect(compiler.bus.history("build/pipeline")).toContainEqual(
      expect.objectContaining({ subject: "flush", reason: "queued behind the in-flight flush" }),
    );
  });

  it("does not follow on when nothing is left unflushed", async () => {
    /**
     * The flush body reaches back into the compiler — `syncGraphs` asks content
     * facets for translations, which can transform, and `transform` schedules a
     * flush. An unconditional follow-on therefore livelocks, each run dirtying
     * just enough to justify the next. It surfaced as a dev server that stopped
     * pushing updates and a contract that timed out at 45 s.
     */
    const compiler = makeCompiler();
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));

    let runs = 0;
    stubRunFlush(compiler, async () => {
      runs++;
      if (runs === 1) await first;
    });

    const all = [compiler.flush(), compiler.flush(), compiler.flush()];
    release();
    await Promise.all(all);

    expect(runs).toBe(1);
  });

  it("collapses several mid-flush callers onto one follow-on", async () => {
    const compiler = makeCompiler();
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));

    let runs = 0;
    stubRunFlush(compiler, async () => {
      runs++;
      if (runs === 1) {
        await first;
        compiler.messages.dirtyBoundaries.add("b_late");
      } else {
        compiler.messages.dirtyBoundaries.clear();
      }
    });

    const all = [compiler.flush(), compiler.flush(), compiler.flush(), compiler.flush()];
    release();
    await Promise.all(all);

    // One in-flight run plus exactly one follow-on covering all three waiters.
    expect(runs).toBe(2);
  });
});

describe("graph rebuild custody", () => {
  it("discards a rebuild that a newer one overtook", async () => {
    /**
     * `graphDirty` is cleared before the async body runs, so a transform during
     * a rebuild starts a second, concurrent one. Both assigned the graphs on
     * completion, and the winner was whichever *finished* last rather than
     * whichever started last.
     *
     * A rebuild replaces state, so D1 applies here — unlike invalidation, which
     * accumulates (ZDB §4.1a).
     */
    const compiler = makeCompiler();
    const bus = compiler.bus;

    const stale = bus.mint("build/pipeline", "graph", { seq: 1 });
    bus.accept(stale);
    const fresh = bus.mint("build/pipeline", "graph", { seq: 2 });
    bus.accept(fresh);

    // The slow, earlier rebuild finishes last and must stand down.
    expect(bus.holds(stale)).toBe(false);
    expect(bus.holds(fresh)).toBe(true);
  });
});
