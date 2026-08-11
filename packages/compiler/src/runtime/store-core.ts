declare const process: any;
/**
 * Build-time sentinel, substituted to a literal `true`/`false` by
 * `getRuntimeCode()` before this module is ever served.
 *
 * A literal is the point: `typeof process !== "undefined" && ...` looked like a
 * safe dev guard, but `process` is undefined in browsers, so it short-circuited
 * to false and every branch behind it was dead client-side. With a literal,
 * production builds eliminate the branch outright and dev builds keep it.
 */
declare const __ZINTL_DEV__: boolean;

/**
 * Build-time sentinel, substituted to a literal array by `getRuntimeCode()`.
 *
 * The locales this project renders right-to-left, derived at build time from
 * the `dir` field content facets read out of their catalogs — so the runtime
 * carries the answer without carrying a table of RTL languages, which would put
 * knowledge in the store that belongs to a facet.
 *
 * Empty is meaningful, not missing: a project with no direction data leaves
 * `<html dir>` alone rather than asserting `"ltr"` on a document that never had
 * the attribute.
 */
declare const __ZINTL_RTL_LOCALES__: string[];

export type Catalog = Record<string, string | Function>;
export type BoundaryCatalogs = Record<string, Catalog>;
export type Catalogs = Record<string, BoundaryCatalogs>;
export type LoaderResult = Catalog | BoundaryCatalogs | Promise<Catalog | BoundaryCatalogs>;
export type Loader = (locale: string) => LoaderResult;

export let storeStorage: any = null;
export function setStoreStorage(storage: any) {
  storeStorage = storage;
}

export let runInRequestScope = <T>(
  _urlOrReq: any,
  _locales: string[],
  _defaultLocale: string,
  callback: () => T,
): any => {
  return callback();
};

export function setRunInRequestScope(fn: any) {
  runInRequestScope = fn;
}

/**
 * Delivery accounting — the normative rules are in `docs/spec/ZDB.md`.
 *
 * This is a second, minimal implementation of the axioms the compiler's
 * `DeliveryBus` also implements. That duplication is deliberate: runtime modules
 * are read as text and served to the browser by `getRuntimeCode()`, so they
 * cannot import from the compiler's module graph. The two share the
 * specification, not the code — which is why the axioms are written down.
 *
 * Only `subject` and `seq` survive into production (Axiom D5). The ledger and
 * every reason string sit behind `__ZINTL_DEV__` and are eliminated outright.
 */
type DeliveryOutcome = "pending" | "applied" | "superseded" | "failed";

interface Envelope {
  channel: string;
  subject: string;
  seq: number;
  outcome: DeliveryOutcome;
  reason?: string;
}

/**
 * Entries retained in the development ledger.
 *
 * Bounded is normative, not an optimization: the `memory-leak` contract measures
 * retained heap across twenty consecutive hot updates against a budget with only
 * a few hundred kilobytes of headroom.
 */
const LEDGER_LIMIT = 128;

/**
 * Publish the settle beacon's zero on runtime startup.
 *
 * So that "the counter is absent" unambiguously means "no Zintl runtime on this
 * page", rather than the ambiguous "runtime present but nothing has settled
 * yet". A harness cannot act on a signal it cannot distinguish from silence.
 */
function publishBeaconZero() {
  if (!__ZINTL_DEV__) return;
  (globalThis as { __zintl_version?: number }).__zintl_version ??= 0;
}

/**
 * Record a settled envelope, and advance the settle beacon.
 *
 * The beacon is now derived from delivery outcomes rather than from `notify()`,
 * and that is the substantive change. It used to advance only when a catalog
 * value actually differed, so a redelivery carrying identical content advanced
 * nothing — making "applied, unchanged" indistinguishable from "lost", which is
 * exactly what a harness must be able to tell apart (Corollary D2a).
 *
 * Counting every terminal outcome, not just `applied`, is the point: a harness
 * asks "has the store finished with my change?", and `superseded` is a finished
 * answer. Listeners are a separate concern and still fire only on real change.
 *
 * Process-global rather than request-scoped, which is safe precisely because
 * nothing reads it except a harness driving a single page. The *ordering* state
 * that must not leak across requests lives on the store instance instead.
 */
function recordSettle(envelope: Envelope) {
  if (!__ZINTL_DEV__) return;
  const scope = globalThis as { __zintl_version?: number; __zintl_ledger?: Envelope[] };
  scope.__zintl_version = (scope.__zintl_version ?? 0) + 1;
  const ledger = (scope.__zintl_ledger ??= []);
  ledger.push(envelope);
  if (ledger.length > LEDGER_LIMIT) ledger.shift();
}

const DELIVERY_KEY_SEP = "\n";

/**
 * Per-store delivery ledger.
 *
 * Lives on the instance, never in module scope: the store is request-scoped
 * under SSR, and a process-global sequence would let one request's ordering
 * state decide another's — the classic shape of cross-request contamination.
 */
class Delivery {
  private readonly minted = new Map<string, number>();
  private readonly applied = new Map<string, number>();

  /**
   * `seq` is supplied wherever an upstream monotonic counter already exists —
   * the compiler stamps generated catalogs with the generation that produced
   * them. Minting a parallel clock beside one the producer already has would
   * only create a second thing to keep in step.
   */
  mint(channel: string, subject: string, seq?: number): Envelope {
    const key = channel + DELIVERY_KEY_SEP + subject;
    const prior = this.minted.get(key) ?? 0;
    const next = seq ?? prior + 1;
    if (next > prior) this.minted.set(key, next);
    return { channel, subject, seq: next, outcome: "pending" };
  }

  /**
   * Axiom D1 — claim this subject, unless something newer already holds it.
   *
   * `<=` rather than `<`: a redelivery at the same sequence carries no new
   * information, and letting it read as progress would make a duplicate
   * indistinguishable from an advance.
   */
  accept(envelope: Envelope): boolean {
    const key = envelope.channel + DELIVERY_KEY_SEP + envelope.subject;
    const prior = this.applied.get(key);
    if (prior !== undefined && envelope.seq <= prior) {
      if (__ZINTL_DEV__) this.settle(envelope, "superseded", "overtaken by seq " + prior);
      return false;
    }
    this.applied.set(key, envelope.seq);
    return true;
  }

  /**
   * Whether this envelope still holds its subject.
   *
   * Asked *after* an await, by work that claimed the subject before one. It is
   * what stops a slow locale switch from writing over a faster one that started
   * later — the defect where the DOM settles on an intermediate value.
   */
  holds(envelope: Envelope): boolean {
    return (
      this.applied.get(envelope.channel + DELIVERY_KEY_SEP + envelope.subject) === envelope.seq
    );
  }

  /**
   * Axiom D2 — drive an envelope to a terminal outcome.
   *
   * Entirely development-only, and every caller guards the call as well as this
   * body. `mint`, `accept` and `holds` are the ordering machinery and ship;
   * `settle` only ever labels what already happened, and nothing in production
   * reads a label. Guarding here alone would still leave the reason strings in
   * the bundle as evaluated arguments — a guard the bundler can fold has to
   * enclose the *call*, not just the callee.
   */
  settle(envelope: Envelope, outcome: Exclude<DeliveryOutcome, "pending">, reason?: string) {
    if (!__ZINTL_DEV__) return;
    if (envelope.outcome !== "pending") return;
    envelope.outcome = outcome;
    if (reason !== undefined) envelope.reason = reason;
    recordSettle(envelope);
  }
}

/**
 * Report an abandoned catalog delivery.
 *
 * Every abandonment path needs the same three things — a named outcome, the
 * subject it belongs to, and a development log — and having them in one place is
 * what stops the next one being added without them.
 *
 * A free function rather than a method on purpose. Both are development-only,
 * but once every call site folds away a free function is unreferenced and goes
 * with them, whereas a method stays on the prototype forever. The earlier
 * version was worse still: a closure allocated per load that, in production,
 * compiled to `(reason, err) => {}`.
 */
function reportDeliveryFailure(
  delivery: Delivery,
  target: string,
  boundaryId: string,
  reason: string,
  err?: unknown,
) {
  if (!__ZINTL_DEV__) return;
  delivery.settle(delivery.mint("runtime/catalog", target + "/" + boundaryId), "failed", reason);
  console.error(
    `[Zintl] Catalog delivery failed for boundary "${boundaryId}" (${target}): ${reason}. ` +
      `Its text will render blank until something reloads it.`,
    err,
  );
}

export class I18nStore {
  locale: string = "";
  catalogs: Catalogs = {};
  locales: string[] = [];
  /**
   * Enabled by `ZINTL_DEBUG=true` on the server, or `globalThis.__ZINTL_DEBUG`
   * in a browser. The browser path exists because the env-var check alone is
   * unreachable client-side, which is why client debug logging never appeared.
   */
  debug: boolean =
    __ZINTL_DEV__ &&
    ((typeof process !== "undefined" && process.env.ZINTL_DEBUG === "true") ||
      (globalThis as { __ZINTL_DEBUG?: boolean }).__ZINTL_DEBUG === true);
  pendingBoundaries = new Set<string>();
  pendingPromises: Promise<any>[] = [];
  version: number = 0;
  private listeners = new Set<() => void>();
  private readonly delivery = new Delivery();
  /**
   * In-flight lazy loads, by `<locale>/<boundaryId>`.
   *
   * A concurrent request for a boundary already loading used to be dropped and
   * handed back `undefined` — no promise to await, no queue, nothing to
   * supersede. Keeping the promise lets a second caller join instead of vanish.
   */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor() {
    publishBeaconZero();
    if (typeof document !== "undefined" && document.documentElement) {
      this.locale = document.documentElement.lang || "";
    }
    if (!this.locale && typeof window !== "undefined") {
      try {
        this.locale = localStorage.getItem("zintl-locale") || "";
      } catch {}
    }
    if (!this.locale) {
      try {
        if (storeStorage) {
          const active = storeStorage.getStore();
          if (active && active !== this) {
            this.locale = active.locale;
          }
        }
      } catch {}
    }
    if (typeof window !== "undefined" && (window as any).__zintl_baked_catalogs) {
      this.addCatalogs((window as any).__zintl_baked_catalogs);
    }
  }

  getLocales(): string[] {
    if (
      this.locales.length === 0 &&
      typeof window !== "undefined" &&
      (window as any).__zintl_locales
    ) {
      this.locales = (window as any).__zintl_locales;
    }
    return this.locales;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Tell subscribers something changed.
   *
   * `version` is bumped here rather than by each caller, so it cannot drift out
   * of step with what listeners have been told. The settle beacon is no longer
   * bumped here at all — it follows delivery outcomes now, which is what lets a
   * no-op update still register as having been processed.
   *
   * Listeners are isolated from one another: `forEach` over a raw set meant one
   * throwing subscriber silently cancelled every subscriber after it.
   */
  notify() {
    this.version++;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        if (__ZINTL_DEV__) {
          console.error("[Zintl] A store subscriber threw; the rest still ran.", err);
        }
      }
    }
  }

  /**
   * @param seq The generation that produced this catalog, when the producer has
   * one. Supplied by compiler-generated content modules; absent when a loader
   * hands back a catalog, where there is nothing to order against.
   */
  addCatalogs(newCatalogs: Catalogs, seq?: number) {
    let changed = false;
    const delivered: string[] = [];

    for (const [locale, boundaries] of Object.entries(newCatalogs)) {
      if (!this.catalogs[locale]) {
        this.catalogs[locale] = {};
      }
      for (const [boundaryId, messages] of Object.entries(boundaries)) {
        const subject = locale + "/" + boundaryId;

        /**
         * Axiom D1 — a catalog carrying a sequence can be overtaken.
         *
         * The compiler stamps each generated catalog module with the generation
         * that produced it, so a module arriving after a newer one has already
         * been applied is discarded *by number* rather than by luck. This is
         * what makes a burst of rapid edits settle on the last one by
         * construction: an out-of-order arrival cannot win, however the network
         * happens to order the fetches.
         */
        if (seq !== undefined) {
          const envelope = this.delivery.mint("runtime/catalog", subject, seq);
          if (!this.delivery.accept(envelope)) continue;
        }

        delivered.push(subject);
        if (!this.catalogs[locale][boundaryId]) {
          this.catalogs[locale][boundaryId] = {};
        }
        for (const [key, value] of Object.entries(messages as Catalog)) {
          if (this.catalogs[locale][boundaryId][key] !== value) {
            this.catalogs[locale][boundaryId][key] = value;
            changed = true;
          }
        }
      }
    }

    /**
     * Corollary D2a — every boundary this call described gets an outcome, even
     * when its content was already identical.
     *
     * The old code advanced nothing unless a value differed, so an idempotent
     * redelivery and a lost one looked the same from outside. Listeners still
     * only run on real change: a subscriber has nothing to do when nothing
     * moved, but an observer still needs to know the store finished.
     *
     * Development-only (Axiom D5). These envelopes are pure observation — no
     * ordering decision hangs on them, because nothing upstream yet stamps a
     * catalog with a sequence to compare. Minting one per boundary on every
     * application would be allocation in a hot path bought for nothing.
     */
    if (__ZINTL_DEV__) {
      for (const subject of delivered) {
        this.delivery.settle(this.delivery.mint("runtime/catalog", subject), "applied");
      }
    }

    if (changed) {
      if (__ZINTL_DEV__ && this.debug) {
        console.debug("[Zintl] Catalogs updated:", delivered);
      }
      this.notify();
    }
  }

  /**
   * Publish the switch to the document and to storage.
   *
   * Deliberately **not** called before the slot is claimed. These are the only
   * externally visible effects of a locale change that are not routed through
   * the store, so a switch that is about to be superseded must not perform
   * them: it would leave `documentElement.lang` describing a language the store
   * never adopted, and the page rendering one locale while announcing another.
   */
  private publishLocale(locale: string) {
    if (typeof window === "undefined") return;

    /**
     * The store owns the document's locale attributes; the projection owns
     * everything document-specific. Both run, in that order.
     *
     * This used to be an either/or — call `__zintlApplyHtml` if installed,
     * otherwise set `lang` — and the branch was the bug. The projection installs
     * itself unconditionally but only writes `dir` when the project has an RTL
     * locale, so on every other project it took ownership of the document and
     * then declined to finish the job, silently suppressing the fallback that
     * would have (ledger L-019). Sequencing them removes the question: the store
     * always says what locale it adopted, and the projection still applies the
     * title, description and body deltas only it knows about.
     *
     * `dir` is set only when the project actually has direction data. Empty
     * means "this project never spoke about direction", and asserting `"ltr"`
     * there would start writing an attribute onto documents that never had one.
     */
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = locale;
      if (__ZINTL_RTL_LOCALES__.length > 0) {
        document.documentElement.dir = __ZINTL_RTL_LOCALES__.includes(locale) ? "rtl" : "ltr";
      }
    }

    (window as any).__zintlApplyHtml?.(locale);

    try {
      localStorage.setItem("zintl-locale", locale);
    } catch {}
  }

  async setLocale(locale: string | null | undefined) {
    if (!locale) return;

    if (this.locale === locale && Object.keys(this.catalogs[locale] || {}).length > 0) {
      /**
       * Already there — but still an outcome, never a silent return (Axiom D2),
       * so anything waiting on this switch learns it finished instead of
       * waiting out a timeout.
       *
       * Settled deliberately *without* claiming the slot. A no-op that took the
       * slot would supersede a real switch already in flight and then do no work
       * itself, leaving nothing to notify and the UI waiting on an update that a
       * call changing nothing had quietly cancelled. `getActiveInstance` fires
       * `setLocale` from a getter, so overlapping switches to the same locale
       * are routine rather than exotic.
       */
      // Safe here without claiming: the store is already on this locale, so
      // publishing it cannot make the document disagree with the store.
      this.publishLocale(locale);
      if (__ZINTL_DEV__) {
        this.delivery.settle(
          this.delivery.mint("runtime/locale", "active"),
          "applied",
          "already active",
        );
      }
      return;
    }

    /**
     * One envelope per switch, on a single subject.
     *
     * The subject is the store's *active-locale slot*, not the target locale —
     * there is only one active locale, so a switch to "fr" and a switch to "ar"
     * compete for the same thing and must be able to supersede each other.
     * Keying by target locale would let them run as unrelated deliveries, which
     * is precisely the interleaving this is here to stop.
     */
    const envelope = this.delivery.mint("runtime/locale", "active");
    this.delivery.accept(envelope);

    /**
     * Claim, then publish — in one synchronous block, with no await between.
     *
     * Claims are ordered, so whichever switch claims last also publishes last
     * and the document ends up describing the locale the store actually
     * adopted. Publishing *before* the claim let a switch that was then
     * superseded rewrite `documentElement.lang` anyway, leaving Arabic content
     * on a page announcing itself as English.
     */
    this.publishLocale(locale);

    if (__ZINTL_DEV__ && this.debug) {
      console.debug(`[Zintl] Switching to locale: ${locale}`);
    }
    this.locale = locale;

    const activePromises: Promise<void>[] = [];

    for (const [boundaryId, loader] of globalRegistry.entries()) {
      try {
        const result = loader(locale);
        const processResult = (res: Catalog | BoundaryCatalogs) => {
          if (!res) return;
          this.addCatalogs({ [locale]: res } as Catalogs);
        };

        if (isThenable(result)) {
          this.pendingBoundaries.add(boundaryId);
          activePromises.push(
            (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
              processResult(res);
              this.pendingBoundaries.delete(boundaryId);
            }),
          );
        } else {
          processResult(result);
        }
      } catch (err) {
        if (__ZINTL_DEV__) {
          console.error(
            `[Zintl] Failed to load catalog for boundary "${boundaryId}" (${locale})`,
            err,
          );
        }
      }
    }

    if (activePromises.length > 0) {
      await Promise.all(activePromises);
    }

    /**
     * Axiom D1, applied where it matters: a newer switch may have started and
     * finished while this one was loading. Whoever claimed the slot last wins,
     * by sequence — not by whose promises happened to settle last.
     *
     * Without this, two overlapping switches each wrote `this.locale` and each
     * notified, and the final state was decided by network timing.
     */
    if (!this.delivery.holds(envelope)) {
      if (__ZINTL_DEV__) {
        this.delivery.settle(envelope, "superseded", "a newer locale change took the slot");
      }
      return;
    }

    if (__ZINTL_DEV__) this.delivery.settle(envelope, "applied");
    if (__ZINTL_DEV__ && this.debug) {
      console.debug(`[Zintl] Locale "${locale}" hydrated.`);
    }
    this.notify();
  }

  registerLoader(boundaryId: string, loader: Loader) {
    globalRegistry.set(boundaryId, loader);

    /**
     * Capture the locale before calling the loader, and file the result under
     * the captured value.
     *
     * Reading `this.locale` *again* after the await filed the catalog under
     * whatever locale happened to be active when the promise resolved — so a
     * switch landing mid-load stored one language's strings under another's key.
     */
    const target = this.locale;

    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) {
        if (__ZINTL_DEV__) {
          reportDeliveryFailure(this.delivery, target, boundaryId, "loader resolved empty");
        }
        return;
      }
      // The success outcome is settled by `addCatalogs`, which is where the
      // application actually happens.
      this.addCatalogs({ [target]: res } as Catalogs);
    };

    try {
      const result = loader(target);
      if (isThenable(result)) {
        this.pendingBoundaries.add(boundaryId);
        /**
         * Publish this load so {@link loadLazyBoundary} can join it.
         *
         * This path used to record itself only in `pendingBoundaries`, which
         * nothing consults before serving a catalog — so an in-flight load
         * started *here* was invisible to a caller asking for the same boundary
         * *there*, and that caller was handed whatever was already present.
         *
         * Harmless when the catalogs are empty, which is the only case that
         * existed before hot updates reached a host that re-executes the
         * manager and the entry independently. On such a host it is the
         * empty-render defect: the manager re-registers, this load goes out for
         * the new catalog, the entry re-executes and reads the old one, and
         * every key that exists only in the new one resolves to "" — because
         * Zintl has no source-locale fallback, by design.
         */
        const subject = target + "/" + boundaryId;
        const inFlight = (result as Promise<Catalog | BoundaryCatalogs>)
          .then(processResult)
          .catch((err) => {
            if (__ZINTL_DEV__) {
              reportDeliveryFailure(this.delivery, target, boundaryId, "loader rejected", err);
            }
          })
          .finally(() => {
            this.pendingBoundaries.delete(boundaryId);
            if (this.inFlight.get(subject) === inFlight) this.inFlight.delete(subject);
          });
        this.inFlight.set(subject, inFlight);
        return inFlight;
      }
      processResult(result);
    } catch (err) {
      // A synchronous throw used to propagate out of a registration call made
      // from generated module-evaluation code, taking the whole module with it.
      if (__ZINTL_DEV__) {
        reportDeliveryFailure(this.delivery, target, boundaryId, "loader threw synchronously", err);
      }
    }
  }

  loadLazyBoundary(boundaryId: string, loader: Loader) {
    // Captured once — see `registerLoader` for why reading it again after an
    // await is the cross-filing bug.
    const target = this.locale;
    const subject = target + "/" + boundaryId;

    /**
     * A concurrent request for a boundary already loading used to be dropped
     * and handed back `undefined` — no promise to await, nothing to supersede,
     * and a caller that believed it had triggered a load when it had not.
     *
     * Checked **before** the already-loaded test below, and the order is the
     * fix rather than a tidy-up. A load is in flight precisely because
     * something decided the present catalog needs replacing; serving the
     * present one instead is choosing the older of two known states, which is
     * the inverse of Axiom D1. The two tests only disagree while a refresh is
     * outstanding, and that is exactly the window the empty-render defect lived
     * in: the entry re-executed, found a stale-but-present catalog, returned in
     * zero milliseconds, and rendered "" for every key the incoming catalog was
     * about to supply.
     */
    const joined = this.inFlight.get(subject);
    if (joined) return joined;

    if (this.catalogs[target]?.[boundaryId]) {
      /**
       * Already loaded, and nothing better on the way. Named rather than
       * returned silently (Axiom D2), so a skipped load appears in the ledger
       * instead of looking like nothing happened.
       *
       * Still skips a *refresh* nobody has started — a catalog that is present
       * and stale, with no load outstanding, cannot be re-fetched through this
       * path. That remains true and is not a live problem: every refresh in
       * development arrives as a load somebody did start, which the check above
       * now joins.
       */
      if (__ZINTL_DEV__) {
        this.delivery.settle(
          this.delivery.mint("runtime/catalog", subject),
          "superseded",
          "already loaded",
        );
      }
      return;
    }

    this.pendingBoundaries.add(boundaryId);
    const release = () => {
      this.pendingBoundaries.delete(boundaryId);
      this.inFlight.delete(subject);
    };

    const processResult = (res: any) => {
      if (!res) {
        /**
         * An empty result abandons the boundary: nothing is applied and `_t`
         * keeps returning "" for every key bound to it, permanently, because
         * nothing schedules a retry (ZDB §6 — retry cannot fix ordering, and
         * would turn a loud failure into a slow one).
         *
         * The compiler's integrity check guarantees catalogs are complete, so
         * reaching here means *delivery* failed, not content.
         */
        if (__ZINTL_DEV__) {
          reportDeliveryFailure(this.delivery, target, boundaryId, "loader resolved empty");
        }
        return;
      }
      this.addCatalogs({ [target]: res } as Catalogs);
    };

    try {
      const result = loader(target);

      if (isThenable(result)) {
        const p = (result as Promise<any>)
          .then(processResult)
          .catch((err) => {
            if (__ZINTL_DEV__) {
              reportDeliveryFailure(this.delivery, target, boundaryId, "loader rejected", err);
            }
          })
          .finally(release);

        this.inFlight.set(subject, p);
        this.pendingPromises.push(p);
        /**
         * Drop the promise once it settles.
         *
         * `pendingPromises` gates stream injection on the server, which drains
         * it — but nothing drained it in a browser, so every lazy load a
         * long-lived page performed was retained for the life of the page.
         */
        void p.then(() => {
          const at = this.pendingPromises.indexOf(p);
          // `void` because `splice` hands back the removed promises, and an
          // unused array of promises is what the floating-promise rule catches.
          if (at !== -1) void this.pendingPromises.splice(at, 1);
        });
        return p;
      }

      processResult(result);
      release();
    } catch (err) {
      release();
      if (__ZINTL_DEV__) {
        reportDeliveryFailure(this.delivery, target, boundaryId, "loader threw synchronously", err);
      }
    }
  }
}

export let globalRegistry: Map<string, Loader>;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_registry) {
    (globalThis as any).__zintl_registry = new Map<string, Loader>();
  }
  globalRegistry = (globalThis as any).__zintl_registry;
} else {
  globalRegistry = new Map<string, Loader>();
}

export let defaultInstance: I18nStore;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_default_instance) {
    (globalThis as any).__zintl_default_instance = new I18nStore();
  }
  defaultInstance = (globalThis as any).__zintl_default_instance;
} else {
  defaultInstance = new I18nStore();
}

let currentInstance = defaultInstance;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_current_instance) {
    (globalThis as any).__zintl_current_instance = defaultInstance;
  }
  currentInstance = (globalThis as any).__zintl_current_instance;
}

export function getActiveInstance() {
  if (storeStorage) {
    const store = storeStorage.getStore();
    if (store) return store;
  }
  if (
    typeof window === "undefined" &&
    typeof globalThis !== "undefined" &&
    (globalThis as any).__zintl_active
  ) {
    return (globalThis as any).__zintl_active;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_current_instance) {
    return (globalThis as any).__zintl_current_instance;
  }
  if (typeof window !== "undefined") {
    const inst = currentInstance;
    const locales = inst.getLocales();
    const docLang =
      typeof document !== "undefined" && document.documentElement
        ? document.documentElement.lang
        : "";

    let targetLocale = "";
    const pathname = window.location ? window.location.pathname : "";
    if (pathname && locales.length > 0) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        targetLocale = parts[0];
      }
    }

    if (!targetLocale && docLang && locales.includes(docLang)) {
      targetLocale = docLang;
    }

    if (targetLocale && targetLocale !== inst.locale) {
      void inst.setLocale(targetLocale);
    }
  }
  return currentInstance;
}

export function setActiveInstance(instance: I18nStore) {
  currentInstance = instance;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__zintl_current_instance = instance;
  }
}

export function registerLoader(boundaryId: string, loader: Loader) {
  globalRegistry.set(boundaryId, loader);

  const instance = getActiveInstance();
  /**
   * Capture once, and file the result under the captured value — reading
   * `instance.locale` again after the await stored the catalog under whatever
   * locale happened to be active when the promise resolved.
   */
  const target = instance.locale;
  if (instance.catalogs[target]?.[boundaryId]) {
    return;
  }
  try {
    const result = loader(target);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      instance.addCatalogs({ [target]: res } as Catalogs);
    };

    if (isThenable(result)) {
      const p = (result as Promise<Catalog | BoundaryCatalogs>)
        .then(processResult)
        // Without this the rejection escaped as an unhandled promise, which in
        // a browser is a console entry nobody attributes to a missing catalog.
        .catch((err) => {
          if (__ZINTL_DEV__) {
            console.error(
              `[Zintl] Catalog delivery failed for boundary "${boundaryId}" (${target}).`,
              err,
            );
          }
        });
      if ((instance as any).pendingPromises) {
        (instance as any).pendingPromises.push(p);
      }
      return p;
    } else {
      processResult(result);
    }
  } catch (err) {
    if (__ZINTL_DEV__) {
      console.error(`[Zintl] Failed to load initial catalog for boundary "${boundaryId}"`, err);
    }
  }
}

export function unregisterLoader(boundaryId: string) {
  globalRegistry.delete(boundaryId);
}

export function setLocale(locale?: string | null) {
  return getActiveInstance().setLocale(locale);
}

export function getLocale() {
  return getActiveInstance().locale;
}

export function subscribe(listener: () => void) {
  return getActiveInstance().subscribe(listener);
}

export function addCatalogs(catalogs: Catalogs, seq?: number) {
  return getActiveInstance().addCatalogs(catalogs, seq);
}

export function getStoreVersion() {
  return getActiveInstance().version;
}

export function isThenable(obj: any): obj is Promise<any> {
  return obj && typeof obj.then === "function";
}
