/**
 * Delivery bus vocabulary — the normative rules are in `docs/spec/ZDB.md`.
 *
 * Zintl performs the same shape of work in four places: something changes, a
 * procedure runs, and a result is delivered elsewhere. Each of those is
 * repetitive, concurrent, and capable of conflicting with itself. These types
 * give such a delivery the three properties it needs to be governable — an
 * identity, an order, and an outcome.
 */

/**
 * A namespace of comparable work.
 *
 * Envelopes are ordered strictly *within* a channel and never across one. There
 * is deliberately no global clock: the runtime store is request-scoped under
 * SSR, so a process-global counter would leak sequence state between concurrent
 * requests — the classic shape of cross-request contamination.
 */
export type DeliveryChannel =
  /** A catalog application. Subject: boundary id. */
  | "runtime/catalog"
  /** A locale change. Subject: the target locale. */
  | "runtime/locale"
  /** A file change becoming an emitted update. Subject: source file path. */
  | "build/hmr"
  /** A compiler stage run. Subject: stage name (`flush`, `graph`, `hive`). */
  | "build/pipeline"
  /** An artifact write. Subject: absolute output path. */
  | "io/write";

/**
 * The state of an envelope.
 *
 * `pending` is **not** terminal. ZDB Axiom D2 requires every minted envelope to
 * reach one of the other three: coalescing is `superseded`, not a disappearance,
 * and an envelope left `pending` is by definition a defect.
 */
export type DeliveryOutcome = "pending" | "applied" | "superseded" | "failed";

/** The terminal subset of {@link DeliveryOutcome}. */
export type TerminalOutcome = Exclude<DeliveryOutcome, "pending">;

/**
 * The unit of governed delivery.
 *
 * `subject` and `seq` are the load-bearing pair and are the only fields that
 * ship to production (ZDB §8). `cause` and `reason` exist to explain a failure
 * after the fact and are development-only.
 */
export interface Envelope {
  readonly channel: DeliveryChannel;
  /**
   * The supersession key. Two envelopes sharing a subject describe the same
   * thing at different times, which is exactly what makes one able to overtake
   * the other.
   */
  readonly subject: string;
  /**
   * Monotonic within `(channel, subject)`. The sole ordering authority — never
   * arrival time, never a debounce window.
   */
  readonly seq: number;
  outcome: DeliveryOutcome;
  /** The `seq` of the envelope that caused this one. Development-only. */
  cause?: number;
  /** Why this envelope failed or was superseded. Development-only. */
  reason?: string;
}

/** A settled envelope, as recorded in the ledger. */
export interface DeliveryLedgerEntry {
  readonly channel: DeliveryChannel;
  readonly subject: string;
  readonly seq: number;
  readonly outcome: TerminalOutcome;
  readonly cause?: number;
  readonly reason?: string;
}
