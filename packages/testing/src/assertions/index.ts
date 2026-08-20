import { expect } from "vite-plus/test";
import type { Lab } from "../environment/lab.js";
import { findCatalogFor } from "../contracts/catalog.js";
import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/**
 * How long any single page read inside {@link LabAssertions.describeStall} may
 * take before it is abandoned.
 *
 * Short on purpose. This budget is only ever spent on a page that is already
 * failing, and there are several reads — the diagnosis has to finish inside the
 * reserve the contract runner keeps back for it.
 */
const PAGE_READ_BUDGET_MS = 1500;

/**
 * Reject rather than hang.
 *
 * Every page read in `describeStall` is already wrapped in a `try/catch` with a
 * message describing what could not be read — and none of them ever fired for
 * the failure that needed them most, because **an unresponsive renderer does not
 * reject; it simply never answers.** Playwright waits out its own default, which
 * is longer than the test's entire budget, so the test was killed with its
 * diagnosis still unwritten.
 *
 * Ledger L-039 cost five investigations to that: a page pinned by an update loop
 * produced timeouts carrying no page state at all, and the loop was found only
 * by a throwaway probe that streamed console output to a file. Turning a hang
 * into a rejection is what lets the existing `catch` blocks do the job they were
 * written for.
 */
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} did not answer within ${PAGE_READ_BUDGET_MS}ms`)),
        PAGE_READ_BUDGET_MS,
      ),
    ),
  ]);
}

export class LabAssertions {
  private lab: Lab;

  constructor(lab: Lab) {
    this.lab = lab;
  }

  /**
   * Assert an element's text eventually contains `expected`.
   *
   * Prefer this over `locator.waitFor({ state: "visible" })` followed by
   * `textContent()`. That pair looks like it waits, but `waitFor` resolves
   * immediately when the element is *already* visible showing the previous
   * value — so the read races the update and the timeout never engages. Every
   * flaky contract we have traced came from that shape.
   *
   * Polls the live DOM until the text matches or the timeout expires, and
   * reports the last value it saw so a genuine stall is diagnosable.
   */
  async textEventually(
    selector: string,
    expected: string,
    opts?: { timeout?: number; interval?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? 15000;
    const interval = opts?.interval ?? 50;
    const locator = this.lab.page.locator(selector).first();

    try {
      await expect
        .poll(async () => (await locator.textContent().catch(() => null)) ?? "", {
          timeout,
          interval,
        })
        .toContain(expected);
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n\n${await this.describeStall(selector, expected)}`,
      );
    }
  }

  /**
   * Explain *why* the DOM never reached the expected text.
   *
   * A bare "expected X to contain Y" cannot distinguish an update the dev server
   * never sent, one the client never applied, and one that rendered into a
   * different element. Each of those has a different fix, so the failure needs
   * to carry enough state to tell them apart — otherwise every occurrence costs
   * a fresh investigation.
   */
  async describeStall(selector?: string, expected?: string): Promise<string> {
    /**
     * Project-mode labs have no page, and saying so beats guessing at one.
     *
     * `build`, `graph` and the transform contracts run without a browser, and
     * this diagnosis was attached to their failures regardless — so a snapshot
     * mismatch in a production bundle reported "hmr packets: unavailable",
     * "settle beacon: unreadable" and, worst of all, `← the page itself is the
     * failure`, pointing an investigation at a browser that was never opened.
     * The compiler-side sections below are genuinely useful in project mode and
     * are kept; the browser-side ones are skipped rather than answered wrongly.
     */
    const hasPage = Boolean((this.lab as { page?: unknown }).page);
    const lines: string[] = [hasPage ? "── page diagnosis ──" : "── build diagnosis (no page) ──"];

    if (hasPage) {
      try {
        const packets = this.lab.ws.recentPackets ?? [];
        const kinds = packets.reduce<Record<string, number>>((acc, p: { type?: string }) => {
          const key = p?.type ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        lines.push(
          `hmr packets: ${packets.length === 0 ? "NONE — the dev server never pushed an update" : JSON.stringify(kinds)}`,
        );
      } catch {
        lines.push("hmr packets: unavailable");
      }

      try {
        const beacon = await withTimeout(
          this.lab.page.evaluate(
            () => (globalThis as { __zintl_version?: number }).__zintl_version,
          ),
          "settle beacon",
        );
        lines.push(
          beacon === undefined
            ? "settle beacon: ABSENT — no Zintl runtime on the page"
            : `settle beacon: ${beacon} (runtime applied ${beacon} update(s))`,
        );
      } catch {
        lines.push("settle beacon: unreadable (page navigating, closed, or unresponsive)");
      }

      /**
       * The delivery ledger — what the runtime was actually asked to do.
       *
       * Packet counts and a beacon say *how much* happened; they cannot say which
       * boundary, in what order, or whether anything was superseded or failed.
       * That is the difference between "the update did not arrive" and "it
       * arrived and was discarded as older than one already applied", which have
       * completely different fixes and used to cost a fresh investigation each.
       */
      try {
        const ledger = await withTimeout(
          this.lab.page.evaluate(
            () =>
              (
                globalThis as {
                  __zintl_ledger?: {
                    channel: string;
                    subject: string;
                    seq: number;
                    outcome: string;
                    reason?: string;
                  }[];
                }
              ).__zintl_ledger,
          ),
          "delivery ledger",
        );
        if (ledger === undefined) {
          lines.push("delivery ledger: ABSENT — no Zintl runtime, or a production build");
        } else if (ledger.length === 0) {
          lines.push("delivery ledger: EMPTY — the runtime was never asked to apply anything");
        } else {
          const notable = ledger.filter((e) => e.outcome !== "applied");
          lines.push(
            `delivery ledger: ${ledger.length} entries, last 6 (oldest first):\n` +
              ledger
                .slice(-6)
                .map(
                  (e) =>
                    `    ${e.channel} ${e.subject} #${e.seq} → ${e.outcome}${e.reason ? ` (${e.reason})` : ""}`,
                )
                .join("\n") +
              (notable.length > 0
                ? `\n  not applied: ${notable.length} (${[...new Set(notable.map((e) => e.outcome))].join(", ")})`
                : ""),
          );
        }
      } catch {
        lines.push("delivery ledger: unreadable (page navigating, closed, or unresponsive)");
      }
    }

    /**
     * The compiler's own ledger, which survives the page.
     *
     * Reachable in project mode too, where there is no page and no socket — and
     * it is the only place a flush that failed, or an update the self-write
     * guard swallowed, is recorded at all.
     */
    try {
      const bus = (
        this.lab.compiler as { instance?: { bus?: { history: (c?: string) => unknown[] } } }
      ).instance?.bus;
      const build = (bus?.history("build/hmr") ?? []) as {
        subject: string;
        seq: number;
        outcome: string;
        reason?: string;
      }[];
      const pipeline = (bus?.history("build/pipeline") ?? []) as typeof build;
      const notable = [...build, ...pipeline].filter((e) => e.outcome !== "applied");
      if (notable.length > 0) {
        lines.push(
          `compiler ledger: ${notable.length} non-applied:\n` +
            notable
              .slice(-5)
              .map(
                (e) =>
                  `    ${e.subject} #${e.seq} → ${e.outcome}${e.reason ? ` (${e.reason})` : ""}`,
              )
              .join("\n"),
        );
      }
    } catch {
      // Project mode without a live compiler, or a compiler with recording off.
    }

    /**
     * `handleHotUpdateHook`'s own trace — whether it ran at all, what Vite
     * handed it, and every module it repointed (ledger L-022, §2.4). The one
     * thing none of the ledgers above can show: a delivery-ledger entry only
     * exists once `invalidateForUpdate` was *called*, so a write the hook
     * silently skipped, or never saw, leaves no trace anywhere except here.
     */
    try {
      const trace = this.lab.compiler.hmrTrace ?? [];
      if (trace.length === 0) {
        lines.push("hmr trace: EMPTY — no hot-update hook ran on this host");
      } else {
        lines.push(
          `hmr trace: ${trace.length} entries, last 40 (oldest first):\n` +
            trace
              .slice(-40)
              .map((e: any) => {
                switch (e.kind) {
                  case "skip-writing":
                    return `    skip-writing ${e.file}`;
                  case "skip-ineligible":
                    return `    skip-ineligible ${e.file}`;
                  case "watch":
                    return `    watch ${e.file} → ${e.reason ?? "(no reason recorded)"}`;
                  case "enter":
                    /**
                     * `modules` is Vite-shaped — its hook hands over a module
                     * array, Rspack's `watchRun` hands a changed-file set and
                     * works out module scope itself. "n/a" says the host does
                     * not report one; "0" would say it reported none, which is
                     * a defect rather than a difference.
                     */
                    return (
                      `    enter ${e.file} seq=${e.seq} modules=${e.modulesLength ?? "n/a"}` +
                      `${e.contentLength !== undefined ? ` bytes=${e.contentLength}` : ""}` +
                      `${e.environment ? ` env=${e.environment}` : ""}`
                    );
                  case "repoint":
                    return `    repoint "${e.moduleId}" ${e.oldFile ?? "(none)"} → ${e.newFile} (boundary=${e.boundaryId}, fileId=${e.fileId})`;
                  case "return":
                    return (
                      `    return ${e.file} invalidated=${e.invalidatedCount}/${e.modulesLength ?? "n/a"}` +
                      `${e.environment ? ` env=${e.environment}` : ""}` +
                      `${e.passthrough ? " (passthrough)" : ""}`
                    );
                  default:
                    return `    ${e.kind} ${e.file}`;
                }
              })
              .join("\n"),
        );
      }
    } catch {
      lines.push("hmr trace: unavailable");
    }

    /**
     * Whether the page is closed, navigating, or simply not answering — asked
     * without a round-trip, because a page that will not answer is exactly the
     * case this has to describe. `isClosed()` and `url()` are Playwright's local
     * state, and the console buffer is filled by events as they arrive, so all
     * three survive a renderer that has stopped servicing evaluations.
     *
     * The distinction is load-bearing for ledger L-039: "unreadable" alone
     * cannot tell a closed context from a wedged one, and those have nothing in
     * common but the symptom.
     */
    if (hasPage) {
      try {
        const closed = this.lab.page.isClosed();
        const all = this.lab.console.messages ?? [];
        lines.push(
          `page liveness: ${closed ? "CLOSED" : "open"} at ${this.lab.page.url()} ` +
            `· ${all.length} console message(s) captured`,
        );
        if (!closed && all.length > 0) {
          lines.push(
            `last console lines:\n${all
              .slice(-4)
              .map((m: { type: string; text: string }) => `    [${m.type}] ${m.text.slice(0, 120)}`)
              .join("\n")}`,
          );
        }
      } catch {
        lines.push("page liveness: unavailable");
      }

      try {
        const errors = this.lab.console.errors ?? [];
        lines.push(
          errors.length === 0
            ? "console errors: none"
            : `console errors:\n${errors
                .slice(0, 5)
                .map((e: { text: string }) => `    ${e.text}`)
                .join("\n")}`,
        );
      } catch {
        lines.push("console errors: unavailable");
      }

      /**
       * The body outline is what distinguishes "the element is missing" from
       * "the page rendered nothing at all". A `page.click` that never finds its
       * target for 30s usually means the second, and only the page state says so.
       */
      try {
        const body = await withTimeout(
          this.lab.page.evaluate(() => {
            const b = document.body;
            return {
              length: b?.innerHTML?.length ?? 0,
              buttons: Array.from(document.querySelectorAll("button"))
                .map((el) => (el.textContent ?? "").trim())
                .slice(0, 8),
              text: (b?.innerText ?? "").trim().slice(0, 160),
            };
          }),
          "body outline",
        );
        lines.push(
          `body html length: ${body.length}${body.length === 0 ? "  ← PAGE IS EMPTY" : ""}`,
        );
        lines.push(
          `buttons present: ${body.buttons.length ? JSON.stringify(body.buttons) : "NONE"}`,
        );
        lines.push(`body text: ${body.text || "(empty)"}`);
      } catch {
        lines.push(
          "page state: unreadable (navigating, closed, or unresponsive)  ← the page itself is the failure",
        );
      }

      if (selector) {
        try {
          const html = await withTimeout(
            this.lab.page
              .locator(selector)
              .first()
              .innerHTML()
              .catch(() => "<not found>"),
            "selector html",
          );
          lines.push(`selector ${selector} html: ${html.slice(0, 200)}`);
          if (expected !== undefined) lines.push(`expected to contain: ${expected}`);
        } catch {
          lines.push(`selector ${selector}: unreadable`);
        }
      }
    }

    return lines.join("\n  ");
  }

  async noHydrationErrors(): Promise<void> {
    await this.lab.clock.waitForIdle();
    const errors = this.lab.console.errors;
    const hydrationErrors = errors.filter(
      (e) =>
        e.text.includes("hydration") ||
        e.text.includes("Hydration") ||
        e.text.includes("Mismatched"),
    );
    if (hydrationErrors.length > 0) {
      throw new Error(
        `Found ${hydrationErrors.length} hydration errors:\n` +
          hydrationErrors.map((e) => e.text).join("\n"),
      );
    }
  }

  async locale(expected: string): Promise<void> {
    const htmlLang = await this.lab.page.getAttribute("html", "lang");
    if (htmlLang !== expected) {
      throw new Error(`Expected page locale to be "${expected}", but found "${htmlLang}"`);
    }
  }

  /**
   * Assert the store and the document agree about the locale.
   *
   * `locale()` checks `html[lang]` and nothing else, so a page rendering one
   * language while announcing another passes it — which is exactly what
   * happened when a superseded locale switch was still allowed to publish:
   * Arabic content on a page declaring `lang="en"`. Both halves were
   * individually plausible and only their disagreement was the bug.
   *
   * The store half is skipped when the runtime is not reachable (a production
   * page, or one that has not booted), rather than failing — this asserts
   * agreement, and there is nothing to disagree with.
   */
  async localeCoherent(expected?: string): Promise<void> {
    const state = await this.lab.page.evaluate(() => {
      const store = (globalThis as { __zintl_current_instance?: { locale?: string } })
        .__zintl_current_instance;
      const html = document.documentElement;
      return {
        storeLocale: store?.locale,
        lang: html.getAttribute("lang"),
        dir: html.getAttribute("dir"),
      };
    });

    if (expected !== undefined && state.lang !== expected) {
      throw new Error(
        `Expected page locale to be "${expected}", but the document says "${state.lang}"` +
          ` (store says "${state.storeLocale}")`,
      );
    }

    if (state.storeLocale && state.lang && state.storeLocale !== state.lang) {
      throw new Error(
        `Locale incoherence: the store is on "${state.storeLocale}" but the document ` +
          `announces "${state.lang}". The page is rendering one language and telling ` +
          `assistive technology and search engines another.\n\n` +
          (await this.describeStall()),
      );
    }
  }

  /**
   * Drive the compiler's pending writes to completion, then return.
   *
   * Two assertions depend on it, from opposite directions: `noOrphanedCatalogs`
   * asks what is still on disk that should not be, and `catalogContains` asks
   * what is not yet on disk that should be. Both are reading the output of work
   * the compiler has scheduled and not finished.
   *
   * A single `await flush()` is not enough, and the compiler says so: a caller
   * arriving mid-flush is handed the **in-flight** promise, and its own dirt is
   * deferred to a later run. `flush()`'s own comment states the guarantee as
   * "your change will be flushed", not "it has been flushed by the time this
   * resolves". Awaiting once therefore returns while the interesting work is
   * still outstanding.
   *
   * Looping on the dirty set rather than on a clock keeps this a causal wait
   * (ZDB §9.3): it terminates because the dirt is empty, not because time
   * passed. The bound is a safety net for a compiler that cannot make progress,
   * and reaching it is a bug worth failing on rather than papering over — so
   * the caller's assertion runs anyway and reports whatever it finds.
   *
   * `satisfied` lets a caller leave the moment its own claim is true, rather
   * than driving the compiler to a quiescence it does not need. That is not an
   * optimisation: on `vue-basic` — the heaviest project here — four full
   * flushes under four-worker contention exhausted the 45-second test cap,
   * green ten times in ten in isolation and red on `ready:examples`. Stopping
   * on the claim keeps the wait causal *and* proportionate; the remaining
   * rounds still exist for the case where the claim never becomes true.
   */
  private async flushUntilQuiescent(rounds = 4, satisfied?: () => boolean): Promise<void> {
    const compiler = this.lab.compiler.instance as
      | {
          flush?(): Promise<void>;
          messages?: { dirtyBoundaries?: Set<string>; hiveDirty?: boolean };
        }
      | undefined;
    if (!compiler?.flush) return;

    for (let i = 0; i < rounds; i++) {
      if (satisfied?.()) return;
      await compiler.flush();
      const dirty =
        (compiler.messages?.dirtyBoundaries?.size ?? 0) > 0 ||
        compiler.messages?.hiveDirty === true;
      if (!dirty) return;
    }
  }

  /**
   * Wait until the compiler has been told `filePath` is gone.
   *
   * A deletion reaches the compiler through the host's watcher, which is
   * asynchronous and entirely outside the harness's control. Until the `unlink`
   * lands, the boundary is still live, still in the prune's known-path set, and
   * its catalogs are correctly *kept* — so asserting on disk before then is
   * racing the watcher and reads a state that was never wrong.
   *
   * Terminates on the condition rather than on elapsed time: it returns as soon
   * as the boundary is forgotten, and fails saying so if it never is. The budget
   * exists because a watcher that never fires is a real defect that should
   * surface here rather than as a puzzling orphan list.
   *
   * **Its failure message used to name that cause outright, and on Rspack the
   * name was wrong.** Traced, the host reports the removal correctly —
   * `1 removed: …/src/App.tsx` — and the boundary comes back seventeen
   * milliseconds later, which is L-071 and not the watcher. A diagnosis frozen
   * into an error string is prose that outlives its measurement, the habit this
   * suite keeps catching itself in, so the message now names both causes and
   * says how to tell them apart.
   */
  async boundaryForgotten(filePath: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.lab.compiler.hasBoundary(filePath)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `The compiler still knows a boundary for ${filePath} ${timeoutMs}ms after it was deleted, ` +
        `so nothing can reclaim what it owned.\n\n` +
        `Matched by: ${this.lab.compiler.matchingBoundaries(filePath).join(", ") || "(nothing — the match is stale)"}\n\n` +
        `Two causes produce this and they are not the same. Either the host never reported the ` +
        `unlink — check the hot-update trace for a "removed" batch — or it did, the compiler ` +
        `forgot the boundary, and something re-registered it (ledger L-071); the compiler logs ` +
        `"Re-registering …, which removeFile had forgotten" when that happens.`,
    );
  }

  /**
   * Assert no catalog on disk belongs to a boundary the compiler no longer has.
   *
   * **Kept, and currently uncalled, deliberately.** `chaos-boundary` called it
   * and was wrong to: `pruneOrphanedBoundaries` returns early when
   * `isDev && !isTestEnv`, so pruning happens in a dev session *only because a
   * test runner is present*, and the assertion verified a code path users never
   * execute. Seven ledger passes and two skipped projects went into that.
   *
   * It is correct and it has a home — pruning is live in **builds**, where
   * nothing asserts it. The contract that should call it is a post-build orphan
   * check gated on `build`, and it is not written yet. Deleting this would mean
   * writing it twice.
   *
   * The reverse of the usual worry. A missing catalog is loud — `verifyIntegrity`
   * throws and the UI goes blank — but an orphan is silent: it sits in the
   * output directory forever, gets committed, gets translated, and describes
   * source that no longer exists.
   */
  async noOrphanedCatalogs(): Promise<void> {
    /**
     * Reclamation happens during a flush, and a flush is debounced.
     *
     * Asking the filesystem the instant the DOM settles reads the disk mid-way
     * through work the compiler has already scheduled — so this asserted on a
     * state that was never meant to be final, and reported deferred work as an
     * orphan. Awaiting the compiler's own `flush()` is a **causal** wait rather
     * than a timed one (ZDB §9.3): it does not sleep hoping the work has
     * happened, it makes the pending work happen and returns when it has.
     */
    await this.flushUntilQuiescent();

    const compiler = this.lab.compiler.instance;
    if (!compiler) return;

    let boundaryIds: string[];
    try {
      boundaryIds = [...(this.lab.compiler.getBoundaryGraph()?.nodes?.keys() ?? [])];
    } catch {
      return;
    }

    /**
     * Both halves of this asked the wrong source, and it went unnoticed because
     * the first half made the second unreachable.
     *
     * The directory came from `(this.lab.compiler as any).outputDir ?? "src/locales"`,
     * and `LabCompiler` has no `outputDir` — the left side was **always**
     * `undefined`. Not one of the four projects claiming `chaos` keeps catalogs
     * in `src/locales`: three use the default `zintl/` and one uses `src/i18n/`.
     * So `existsSync` was false every time and this returned without checking
     * anything, on every project, for its entire life.
     *
     * And the matching underneath it could not have worked either. It compared
     * a file's **basename** against boundary ids by mutual `includes` —
     * `"HelloWorld.vue.ar"` against `"src/components/HelloWorld.vue:default"`,
     * which matches in neither direction. Every catalog under the default
     * `<path>.<locale>.json` naming would have been reported as an orphan.
     *
     * Both are now one question asked of the compiler: `getCatalogPath` already
     * knows where a given boundary's catalog goes for a given locale, including
     * grouped catalogs, `[locale]` tokens and nested-function anchors. Anything
     * on disk that is not in that set belongs to no boundary — which is the
     * claim, stated in the compiler's own terms rather than approximated by
     * substring.
     */
    const resolved = compiler.outputDir;
    if (!resolved) return;
    const outputDir = join(this.lab.root, resolved);
    if (!existsSync(outputDir)) return;

    const locales = new Set<string>();
    const legitimate = new Set<string>();
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".schemas") continue;
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".json") || entry.name.endsWith(".schema.json")) continue;
        // `<name>.<locale>.json` — the locale is the segment before `.json`.
        const parts = entry.name.slice(0, -".json".length).split(".");
        if (parts.length > 1) locales.add(parts[parts.length - 1]);
      }
    };
    await walk(outputDir);

    for (const bId of boundaryIds) {
      for (const locale of locales) {
        const path = compiler.catalog.getCatalogPath(bId, locale);
        if (path) legitimate.add(path);
      }
    }

    const orphans: string[] = [];
    const collect = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".schemas") continue;
          await collect(full);
          continue;
        }
        if (!entry.name.endsWith(".json") || entry.name.endsWith(".schema.json")) continue;
        if (!legitimate.has(full)) orphans.push(relative(this.lab.root, full));
      }
    };
    await collect(outputDir);

    if (orphans.length > 0) {
      throw new Error(
        `${orphans.length} catalog(s) on disk belong to no boundary the compiler knows about:\n` +
          orphans.map((o) => `    ${o}`).join("\n") +
          `\n\nA catalog that outlives its source is not inert — it is committed, translated, ` +
          `and describes code nobody can find.`,
      );
    }
  }

  async dir(expected: "ltr" | "rtl"): Promise<void> {
    const htmlDir = await this.lab.page.getAttribute("html", "dir");
    if (htmlDir !== expected) {
      throw new Error(`Expected page direction to be "${expected}", but found "${htmlDir}"`);
    }
  }

  /**
   * A key reached a catalog on disk, optionally with the value the caller expects.
   *
   * Located through {@link findCatalogFor}, so the catalog is the one the
   * compiler says holds `key` rather than a path this file invented. The
   * previous implementation joined `<root>/<options.outputDir ?? "locales">/
   * <locale>.json` — a flat one-file-per-locale layout **no project in this
   * repository uses**, reached through an `options` property the compiler does
   * not expose. It could only ever throw "Catalog file not found", which is
   * presumably why nothing called it.
   *
   * **Three things had to change before it could be called.**
   *
   * 1. It waits for the compiler first. A key reaches disk during a flush, and
   *    a flush is debounced — reading the directory the instant the DOM settles
   *    asks the question before the work has happened. {@link flushUntilQuiescent}
   *    makes it happen instead of hoping it has (ZDB §9.3), which is what let
   *    ledger L-066's claim come back as a causal assertion rather than the
   *    wall-clock poll that had to be deleted.
   * 2. It reads through the catalog's *shape*. Values are strings in a
   *    per-locale file and objects keyed by locale in a merged one — the same
   *    distinction {@link setTranslation} was given for writing. Comparing
   *    `content[key]` to a string could only ever fail on a merged catalog, so
   *    this assertion was latently broken on `vanilla-spa-basic` and
   *    `rsbuild-vanilla-basic` for its whole life.
   * 3. `value` is optional. "The translator can find this string" is a weaker
   *    claim than "it has been translated", and it is the one §4.1③ makes: a
   *    newly extracted key is written with an empty value until someone fills
   *    it in.
   */
  async catalogContains(opts: { locale: string; key: string; value?: string }): Promise<void> {
    const onDisk = () => {
      const p = findCatalogFor(this.lab, { locale: opts.locale, key: opts.key });
      return p.ok && p.carriesKey;
    };
    await this.flushUntilQuiescent(4, onDisk);

    const probe = findCatalogFor(this.lab, { locale: opts.locale, key: opts.key });
    if (!probe.ok) {
      throw new Error(`Cannot check the catalog for ${JSON.stringify(opts.key)}: ${probe.why}`);
    }
    if (!probe.carriesKey) {
      throw new Error(
        `No catalog for locale ${JSON.stringify(opts.locale)} carries the key ` +
          `${JSON.stringify(opts.key)}. Nearest is ${probe.path}, holding ${probe.keys.length} ` +
          `key(s): ${probe.keys.slice(0, 8).join(", ")}`,
      );
    }
    if (opts.value === undefined) return;

    const content = JSON.parse(await readFile(join(this.lab.root, probe.path), "utf-8"));
    const entry = content[opts.key];
    const actual =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)[opts.locale]
        : entry;

    if (actual !== opts.value) {
      throw new Error(
        `Expected catalog key "${opts.key}" in ${probe.path} to have value "${opts.value}", ` +
          `but got ${JSON.stringify(actual)}`,
      );
    }
  }

  async boundaryExists(id: string): Promise<void> {
    const exists = this.lab.compiler.hasBoundary(id);
    if (!exists) {
      throw new Error(`Boundary "${id}" does not exist in compiler's boundary graph`);
    }
  }

  async textVisible(text: string): Promise<void> {
    expect(this.lab.page.locator("body")).toContain(text);
  }

  async ssrContains(path: string, text: string): Promise<void> {
    const url = `${this.lab.url}${path.startsWith("/") ? path : "/" + path}`;
    const res = await fetch(url);
    const html = await res.text();
    if (!html.includes(text)) {
      throw new Error(`SSR HTML from ${url} does not contain: "${text}"`);
    }
  }

  async snapshot(name: string, value: string): Promise<void> {
    const finalName = `${name}.snap`;
    await expect(value).toMatchFileSnapshot(`./__snapshots__/${finalName}`);
  }

  async snapshotAll(prefix: string, results: Record<string, string>): Promise<void> {
    for (const [file, code] of Object.entries(results)) {
      const finalName = `${file}.snap`;
      await expect(code).toMatchFileSnapshot(`./__snapshots__/${prefix}/${finalName}`);
    }
    await this.assertNoOrphanSnapshots(prefix, results);
  }

  /**
   * Fail when a snapshot exists for output that is no longer produced.
   *
   * `toMatchFileSnapshot` is driven by what the build emitted *this* run, so it
   * can only ever check files that still exist. Stop emitting one — a chunk that
   * disappears, a catalog that is no longer written — and its snapshot is simply
   * never read. The suite stays green while output silently vanished, which is
   * the one regression a snapshot test is supposed to be incapable of missing.
   *
   * Comparing the directory against the produced set closes that: the snapshot
   * directory becomes an assertion about the *shape* of the output, not just the
   * content of whatever survived.
   *
   * Each `snapshotAll` call owns its prefix directory exclusively
   * (`<project>/dist-output`, `/dev-transforms`, `/prod-transforms`), so
   * everything under it is expected to correspond to a produced file.
   */
  private async assertNoOrphanSnapshots(
    prefix: string,
    results: Record<string, string>,
  ): Promise<void> {
    const state = expect.getState() as { testPath?: string; snapshotState?: unknown };
    const testPath = state?.testPath;
    if (!testPath) {
      throw new Error(
        "[Lab] Cannot verify snapshot completeness: vitest did not expose `testPath`. " +
          "Refusing to skip silently — an unchecked orphan snapshot is exactly the " +
          "regression this guard exists to catch.",
      );
    }

    const snapshotDir = join(dirname(testPath), "__snapshots__", prefix);
    if (!existsSync(snapshotDir)) return;

    const onDisk = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name.endsWith(".snap")) {
          onDisk.add(relative(snapshotDir, full).replace(/\\/g, "/").slice(0, -".snap".length));
        }
      }
    };
    await walk(snapshotDir);

    const produced = new Set(Object.keys(results));
    const orphans = [...onDisk].filter((f) => !produced.has(f)).sort();
    if (orphans.length === 0) return;

    /**
     * Under `-u` the author is deliberately re-baselining, so an orphan means
     * "this output is gone on purpose" — remove it, exactly as vitest prunes
     * obsolete inline snapshots. Outside update mode it is a regression.
     */
    if (isUpdatingSnapshots(state.snapshotState)) {
      for (const orphan of orphans) {
        await unlink(join(snapshotDir, `${orphan}.snap`)).catch(() => {});
      }
      return;
    }

    throw new Error(
      `Output disappeared: ${orphans.length} snapshot(s) under __snapshots__/${prefix}/ ` +
        `have no matching file in this run's output.\n` +
        orphans.map((o) => `  - ${o}`).join("\n") +
        `\n\nEither the build stopped emitting them (a regression), or they are ` +
        `intentionally gone — re-run with \`-u\` to prune them.`,
    );
  }
}

/**
 * Whether vitest was invoked with `-u` / `--update`.
 *
 * Read defensively: the flag lives on internal snapshot state, and a wrong
 * answer here is safe in only one direction. Unknown is treated as "not
 * updating", so an orphan is reported rather than quietly deleted.
 */
function isUpdatingSnapshots(snapshotState: unknown): boolean {
  const mode = (snapshotState as { _updateSnapshot?: string; updateSnapshot?: string } | undefined)
    ?._updateSnapshot;
  const fallback = (snapshotState as { updateSnapshot?: string } | undefined)?.updateSnapshot;
  return mode === "all" || fallback === "all";
}
