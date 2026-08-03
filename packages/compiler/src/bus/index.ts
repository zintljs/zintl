/**
 * The delivery bus — build-time implementation.
 *
 * Normative rules: `docs/spec/ZDB.md`. This file implements Axioms D1
 * (monotonic supersession) and D2 (no silent abandonment); D3 (causal custody)
 * is a rule about how *callers* coalesce, and is enforced at each seam rather
 * than here.
 *
 * The runtime deliberately does **not** import this module. Runtime sources are
 * read as text and served to the browser by `getRuntimeCode()`, so they must
 * stay self-contained; the runtime carries its own minimal D1 receiver. The two
 * share the specification, not the code — which is also why the axioms are
 * written down rather than left implicit in an implementation.
 */

import type {
  DeliveryChannel,
  DeliveryLedgerEntry,
  Envelope,
  TerminalOutcome,
} from "../types/delivery.js";

/**
 * Entries retained per channel.
 *
 * Bounded is normative, not an optimization. The `memory-leak` contract
 * measures retained heap across twenty consecutive hot updates against a 3.5 MB
 * budget with roughly 700 KB of headroom; an unbounded history fails it.
 */
export const DEFAULT_HISTORY_LIMIT = 128;

export interface DeliveryBusOptions {
  /**
   * Record settled envelopes and track outstanding ones.
   *
   * Off by default so a caller that forgets gets the cheap bus: the failure
   * mode is "no diagnosis available", never "diagnostic machinery left on".
   */
  record?: boolean;
  /** Entries retained per channel. Ignored when `record` is false. */
  historyLimit?: number;
}

/** A fixed-capacity ring. Overwrites oldest; never grows. */
class Ring<T> {
  private readonly items: (T | undefined)[];
  private next = 0;
  private full = false;

  constructor(private readonly capacity: number) {
    this.items = Array.from({ length: capacity }, () => undefined as T | undefined);
  }

  push(item: T) {
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.full = true;
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = [];
    const start = this.full ? this.next : 0;
    const count = this.full ? this.capacity : this.next;
    for (let i = 0; i < count; i++) {
      const item = this.items[(start + i) % this.capacity];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  clear() {
    this.items.fill(undefined);
    this.next = 0;
    this.full = false;
  }
}

/**
 * Separator for the `(channel, subject)` composite key.
 *
 * A newline cannot occur in a channel name or in any subject we mint (boundary
 * ids, locales, file paths), so the concatenation is unambiguous — unlike a
 * colon, which appears in both chunk ids and virtual module specifiers.
 */
const KEY_SEP = "\n";

export class DeliveryBus {
  private readonly record: boolean;
  private readonly historyLimit: number;

  /** `(channel, subject)` → highest seq accepted. The production-grade state. */
  private readonly applied = new Map<string, number>();
  /** `(channel, subject)` → highest seq minted, for callers that do not supply one. */
  private readonly minted = new Map<string, number>();

  private readonly ledger = new Map<DeliveryChannel, Ring<DeliveryLedgerEntry>>();
  private readonly outstanding = new Set<Envelope>();

  constructor(options: DeliveryBusOptions = {}) {
    this.record = options.record ?? false;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  /**
   * Create an envelope for a delivery about to be attempted.
   *
   * `seq` should be supplied wherever a monotonic counter already exists — the
   * hot-update timestamp and the per-boundary revision both qualify. Minting a
   * parallel clock beside an existing one only creates a second thing to keep in
   * sync. When omitted, a per-subject counter is used.
   */
  mint(
    channel: DeliveryChannel,
    subject: string,
    options: { seq?: number; cause?: number } = {},
  ): Envelope {
    const key = channel + KEY_SEP + subject;
    let seq = options.seq;
    if (seq === undefined) {
      seq = (this.minted.get(key) ?? 0) + 1;
    }
    if (seq > (this.minted.get(key) ?? 0)) {
      this.minted.set(key, seq);
    }

    const envelope: Envelope = { channel, subject, seq, outcome: "pending" };
    if (this.record && options.cause !== undefined) {
      envelope.cause = options.cause;
    }
    if (this.record) this.outstanding.add(envelope);
    return envelope;
  }

  /**
   * Axiom D1 — decide whether this envelope is newer than what was applied.
   *
   * Returns `false` and settles the envelope as `superseded` when it is not.
   * The comparison is `<=`, not `<`: a redelivery at the same sequence carries
   * no new information, and letting it read as progress would make a duplicate
   * indistinguishable from an advance.
   *
   * Acceptance is recorded optimistically — the sequence advances before the
   * caller applies. That is deliberate: a delivery that then fails must still
   * block its own predecessors, because there is no retry (ZDB §6) and an older
   * value winning after a newer one failed is the defect this exists to prevent.
   */
  accept(envelope: Envelope): boolean {
    const key = envelope.channel + KEY_SEP + envelope.subject;
    const prior = this.applied.get(key);
    if (prior !== undefined && envelope.seq <= prior) {
      this.settle(envelope, "superseded", `overtaken by seq ${prior}`);
      return false;
    }
    this.applied.set(key, envelope.seq);
    return true;
  }

  /**
   * Axiom D2 — drive an envelope to a terminal outcome.
   *
   * Settling an already-terminal envelope is a no-op rather than an error: a
   * caller that settles on both a success path and a `finally` is writing
   * defensive code, not a bug, and turning that into a throw would discourage
   * exactly the habit this axiom wants.
   */
  settle(envelope: Envelope, outcome: TerminalOutcome, reason?: string): void {
    if (envelope.outcome !== "pending") return;
    envelope.outcome = outcome;
    if (!this.record) return;

    if (reason !== undefined) envelope.reason = reason;
    this.outstanding.delete(envelope);

    let ring = this.ledger.get(envelope.channel);
    if (!ring) {
      ring = new Ring<DeliveryLedgerEntry>(this.historyLimit);
      this.ledger.set(envelope.channel, ring);
    }
    ring.push({
      channel: envelope.channel,
      subject: envelope.subject,
      seq: envelope.seq,
      outcome,
      cause: envelope.cause,
      reason: envelope.reason,
    });
  }

  /**
   * Whether this envelope still holds its subject.
   *
   * Asked *after* an await, by work that claimed the subject before one. It is
   * what lets a slow rebuild discover that a faster one started later and
   * already won, so it discards its result instead of overwriting a newer
   * world.
   */
  holds(envelope: Envelope): boolean {
    return this.applied.get(envelope.channel + KEY_SEP + envelope.subject) === envelope.seq;
  }

  /**
   * Note an envelope's position without deciding its fate — for work that
   * **accumulates** rather than replaces (ZDB §4.1a).
   *
   * Returns whether this envelope is newer than anything seen for its subject,
   * and advances the high-water mark when it is. It never settles: the caller
   * still owns the outcome, because on an accumulating channel an out-of-order
   * arrival is processed rather than discarded.
   *
   * `accept` is the wrong tool there. It settles a rejected envelope as
   * `superseded`, which on such a channel is simply untrue — the work ran — and
   * a ledger that misreports what happened is worse than no ledger.
   */
  observe(envelope: Envelope): boolean {
    const key = envelope.channel + KEY_SEP + envelope.subject;
    const prior = this.applied.get(key);
    if (prior !== undefined && envelope.seq <= prior) return false;
    this.applied.set(key, envelope.seq);
    return true;
  }

  /** The highest sequence accepted for a subject, or `undefined` if none. */
  lastApplied(channel: DeliveryChannel, subject: string): number | undefined {
    return this.applied.get(channel + KEY_SEP + subject);
  }

  /**
   * Envelopes that never reached a terminal outcome.
   *
   * A non-empty result is an Axiom D2 violation, and naming it is the whole
   * point — an abandoned delivery that nothing records is indistinguishable
   * from one that succeeded. Empty when recording is off.
   */
  outstandingEnvelopes(): Envelope[] {
    return [...this.outstanding];
  }

  /** Settled envelopes, oldest first. Empty when recording is off. */
  history(channel?: DeliveryChannel): DeliveryLedgerEntry[] {
    if (channel) return this.ledger.get(channel)?.toArray() ?? [];
    const out: DeliveryLedgerEntry[] = [];
    for (const ring of this.ledger.values()) out.push(...ring.toArray());
    return out;
  }

  /** Drop history and outstanding tracking. Sequence state is retained. */
  clearHistory(): void {
    for (const ring of this.ledger.values()) ring.clear();
    this.outstanding.clear();
  }
}
