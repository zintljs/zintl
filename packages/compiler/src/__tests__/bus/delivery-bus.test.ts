/**
 * The delivery axioms, asserted.
 *
 * These are not tests of an implementation detail — they are the specification
 * (`docs/spec/ZDB.md` §2) executed. D1 says a later delivery cannot lose to an
 * earlier one; D2 says nothing disappears without a name. Both were written
 * because the system violated them in production, so both are asserted directly
 * rather than inferred from a downstream behaviour.
 */
import { describe, it, expect } from "vite-plus/test";
import { DeliveryBus, DEFAULT_HISTORY_LIMIT } from "../../bus/index.js";

const dev = () => new DeliveryBus({ record: true });

describe("Axiom D1 — monotonic supersession", () => {
  it("accepts a strictly newer sequence", () => {
    const bus = dev();
    expect(bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 1 }))).toBe(true);
    expect(bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 2 }))).toBe(true);
    expect(bus.lastApplied("runtime/catalog", "b_a")).toBe(2);
  });

  it("rejects an older sequence and names it superseded", () => {
    const bus = dev();
    bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 5 }));

    const late = bus.mint("runtime/catalog", "b_a", { seq: 3 });
    expect(bus.accept(late)).toBe(false);
    expect(late.outcome).toBe("superseded");
    expect(late.reason).toContain("5");
    // The receiver's view is unmoved — a late arrival cannot roll it back.
    expect(bus.lastApplied("runtime/catalog", "b_a")).toBe(5);
  });

  it("rejects a redelivery at the same sequence", () => {
    // `<=`, not `<`. A duplicate carries no new information, and letting it
    // read as progress would make it indistinguishable from an advance.
    const bus = dev();
    bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 7 }));

    const duplicate = bus.mint("runtime/catalog", "b_a", { seq: 7 });
    expect(bus.accept(duplicate)).toBe(false);
    expect(duplicate.outcome).toBe("superseded");
  });

  it("converges on the highest sequence regardless of arrival order", () => {
    // This is `hmr-hammer` reduced to its mechanism: five writes, delivered in
    // the worst possible order. The final state must be the newest write, and
    // it must be so by construction rather than by winning a race.
    for (const arrival of [
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
      [3, 1, 5, 2, 4],
      [2, 5, 1, 4, 3],
    ]) {
      const bus = dev();
      const accepted: number[] = [];
      for (const seq of arrival) {
        const env = bus.mint("build/hmr", "src/App.tsx", { seq });
        if (bus.accept(env)) accepted.push(seq);
      }
      expect(bus.lastApplied("build/hmr", "src/App.tsx")).toBe(5);
      // Whatever was accepted, the last acceptance is the newest write —
      // an intermediate value can never be the final applied state.
      expect(Math.max(...accepted)).toBe(5);
      expect(accepted[accepted.length - 1]).toBe(5);
    }
  });

  it("orders per subject, not globally", () => {
    // Boundary A at seq 9 must not silence boundary B at seq 1. Per-subject is
    // the smallest scope that fixes ordering, and the only one that is safe
    // under SSR where a process-global counter would leak across requests.
    const bus = dev();
    bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 9 }));
    expect(bus.accept(bus.mint("runtime/catalog", "b_b", { seq: 1 }))).toBe(true);
  });

  it("orders per channel, not across channels", () => {
    const bus = dev();
    bus.accept(bus.mint("build/hmr", "x", { seq: 100 }));
    expect(bus.accept(bus.mint("io/write", "x", { seq: 1 }))).toBe(true);
  });

  it("observes position without deciding fate, for accumulating work", () => {
    // `observe` is for channels where an out-of-order arrival is still
    // processed (ZDB §4.1a). It reports position and advances the high-water
    // mark, but leaves the outcome to the caller — unlike `accept`, which
    // settles a rejected envelope as `superseded`, a label that would be a
    // plain lie when the work in fact ran.
    const bus = dev();
    expect(bus.observe(bus.mint("build/hmr", "src/App.tsx", { seq: 5 }))).toBe(true);

    const late = bus.mint("build/hmr", "src/App.tsx", { seq: 3 });
    expect(bus.observe(late)).toBe(false);
    expect(late.outcome).toBe("pending");
    expect(bus.history("build/hmr")).toEqual([]);

    // The mark still tracks the newest thing seen.
    expect(bus.lastApplied("build/hmr", "src/App.tsx")).toBe(5);
  });

  it("mints a per-subject sequence when the caller has no counter of its own", () => {
    const bus = dev();
    expect(bus.mint("build/pipeline", "flush").seq).toBe(1);
    expect(bus.mint("build/pipeline", "flush").seq).toBe(2);
    expect(bus.mint("build/pipeline", "graph").seq).toBe(1);
  });

  it("keeps minting above an externally supplied sequence", () => {
    // The hot-update timestamp and the per-boundary revision are supplied from
    // outside. A later mint must not hand back a sequence that would lose to
    // one already in flight.
    const bus = dev();
    bus.mint("build/hmr", "src/App.tsx", { seq: 1700000000 });
    expect(bus.mint("build/hmr", "src/App.tsx").seq).toBe(1700000001);
  });
});

describe("Axiom D2 — no silent abandonment", () => {
  it("mints as pending, which is not terminal", () => {
    const bus = dev();
    const env = bus.mint("runtime/catalog", "b_a");
    expect(env.outcome).toBe("pending");
    expect(bus.outstandingEnvelopes()).toContain(env);
  });

  it("reports an envelope that never settled", () => {
    const bus = dev();
    const abandoned = bus.mint("runtime/catalog", "b_lost");
    const settled = bus.mint("runtime/catalog", "b_ok");
    bus.settle(settled, "applied");

    const outstanding = bus.outstandingEnvelopes();
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toBe(abandoned);
  });

  it("records a failure with its reason", () => {
    const bus = dev();
    const env = bus.mint("runtime/catalog", "b_a");
    bus.settle(env, "failed", "loader resolved empty");

    expect(env.outcome).toBe("failed");
    const [entry] = bus.history("runtime/catalog");
    expect(entry).toMatchObject({
      subject: "b_a",
      outcome: "failed",
      reason: "loader resolved empty",
    });
  });

  it("treats a terminal outcome as final", () => {
    // A caller that settles on both the success path and in a `finally` is
    // writing defensive code, not a bug. First settle wins; the second is a
    // no-op rather than a throw.
    const bus = dev();
    const env = bus.mint("io/write", "/out/ar.json");
    bus.settle(env, "applied");
    bus.settle(env, "failed", "should not overwrite");

    expect(env.outcome).toBe("applied");
    expect(bus.history("io/write")).toHaveLength(1);
  });

  it("carries the causal link between envelopes", () => {
    const bus = dev();
    const write = bus.mint("build/hmr", "src/App.tsx", { seq: 42 });
    const apply = bus.mint("runtime/catalog", "b_a", { seq: 1, cause: write.seq });
    bus.settle(apply, "applied");

    expect(bus.history("runtime/catalog")[0]?.cause).toBe(42);
  });
});

describe("Axiom D5 — cost asymmetry", () => {
  it("still orders correctly with recording off", () => {
    // Ordering is correctness and is never optional; observability is diagnosis
    // and is never shipped. The cheap bus must behave identically on the only
    // axis that affects what a user sees.
    const bus = new DeliveryBus();
    expect(bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 5 }))).toBe(true);

    const late = bus.mint("runtime/catalog", "b_a", { seq: 4 });
    expect(bus.accept(late)).toBe(false);
    expect(late.outcome).toBe("superseded");
    expect(bus.lastApplied("runtime/catalog", "b_a")).toBe(5);
  });

  it("retains nothing with recording off", () => {
    const bus = new DeliveryBus();
    bus.mint("runtime/catalog", "b_never_settled");
    bus.settle(bus.mint("runtime/catalog", "b_a"), "applied", "a reason");

    expect(bus.history()).toEqual([]);
    expect(bus.outstandingEnvelopes()).toEqual([]);
  });
});

describe("the ledger is bounded", () => {
  it("retains at most the limit per channel, newest kept", () => {
    // Bounded is normative, not an optimization: `memory-leak` measures twenty
    // consecutive hot updates against a budget with roughly 700 KB of headroom.
    const bus = new DeliveryBus({ record: true, historyLimit: 4 });
    for (let seq = 1; seq <= 10; seq++) {
      bus.settle(bus.mint("build/hmr", "src/App.tsx", { seq }), "applied");
    }

    const history = bus.history("build/hmr");
    expect(history).toHaveLength(4);
    expect(history.map((e) => e.seq)).toEqual([7, 8, 9, 10]);
  });

  it("bounds each channel independently", () => {
    const bus = new DeliveryBus({ record: true, historyLimit: 2 });
    for (let seq = 1; seq <= 3; seq++) {
      bus.settle(bus.mint("build/hmr", "f", { seq }), "applied");
      bus.settle(bus.mint("io/write", "o", { seq }), "applied");
    }

    expect(bus.history("build/hmr")).toHaveLength(2);
    expect(bus.history("io/write")).toHaveLength(2);
    expect(bus.history()).toHaveLength(4);
  });

  it("defaults to a limit rather than growing without one", () => {
    expect(DEFAULT_HISTORY_LIMIT).toBeGreaterThan(0);

    const bus = new DeliveryBus({ record: true });
    for (let seq = 1; seq <= DEFAULT_HISTORY_LIMIT + 50; seq++) {
      bus.settle(bus.mint("build/hmr", "f", { seq }), "applied");
    }
    expect(bus.history("build/hmr")).toHaveLength(DEFAULT_HISTORY_LIMIT);
  });

  it("clears history without losing sequence state", () => {
    // Diagnosis is disposable; ordering is not. Dropping the ledger must never
    // let an already-superseded update become acceptable again.
    const bus = dev();
    bus.settle(bus.mint("runtime/catalog", "b_a", { seq: 3 }), "applied");
    bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 4 }));
    bus.clearHistory();

    expect(bus.history()).toEqual([]);
    expect(bus.lastApplied("runtime/catalog", "b_a")).toBe(4);
    expect(bus.accept(bus.mint("runtime/catalog", "b_a", { seq: 2 }))).toBe(false);
  });
});
