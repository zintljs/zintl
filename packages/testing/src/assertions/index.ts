import { expect } from "vite-plus/test";
import type { Lab } from "../environment/lab.js";
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
    const lines: string[] = ["── page diagnosis ──"];

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
        this.lab.page.evaluate(() => (globalThis as { __zintl_version?: number }).__zintl_version),
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
          `hmr trace: ${trace.length} entries, last 10 (oldest first):\n` +
            trace
              .slice(-10)
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
                    return `    enter ${e.file} seq=${e.seq} modules=${e.modulesLength ?? "n/a"}`;
                  case "repoint":
                    return `    repoint "${e.moduleId}" ${e.oldFile ?? "(none)"} → ${e.newFile} (boundary=${e.boundaryId}, fileId=${e.fileId})`;
                  case "return":
                    return `    return ${e.file} invalidated=${e.invalidatedCount}/${e.modulesLength ?? "n/a"}${e.passthrough ? " (passthrough)" : ""}`;
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
      lines.push(`body html length: ${body.length}${body.length === 0 ? "  ← PAGE IS EMPTY" : ""}`);
      lines.push(`buttons present: ${body.buttons.length ? JSON.stringify(body.buttons) : "NONE"}`);
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
   * Assert no catalog on disk belongs to a boundary the compiler no longer has.
   *
   * The reverse of the usual worry. A missing catalog is loud — `verifyIntegrity`
   * throws and the UI goes blank — but an orphan is silent: it sits in the
   * output directory forever, gets committed, gets translated, and describes
   * source that no longer exists.
   */
  async noOrphanedCatalogs(): Promise<void> {
    const compiler = this.lab.compiler.instance as
      | { graph?: { boundaryGraph?: { nodes: Map<string, unknown> } }; _outputDir?: string }
      | undefined;
    const graph = compiler?.graph?.boundaryGraph;
    if (!graph) return;

    const outputDir = join(this.lab.root, (this.lab.compiler as any).outputDir ?? "src/locales");
    if (!existsSync(outputDir)) return;

    const live = new Set<string>();
    for (const id of graph.nodes.keys()) {
      live.add(this.lab.compiler.getSafeBoundaryId(id));
      live.add(id);
    }

    const orphans: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".json") || entry.name.endsWith(".schema.json")) continue;
        const stem = entry.name.replace(/\.json$/, "");
        const known = [...live].some((id) => stem.includes(id) || id.includes(stem));
        if (!known) orphans.push(relative(this.lab.root, full));
      }
    };
    await walk(outputDir);

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

  async catalogContains(opts: { locale: string; key: string; value: string }): Promise<void> {
    const outputDir = (this.lab.compiler.instance as any)?.options?.outputDir || "locales";
    const catalogPath = join(this.lab.root, outputDir, `${opts.locale}.json`);
    if (!existsSync(catalogPath)) {
      throw new Error(`Catalog file not found on disk at: ${catalogPath}`);
    }
    const content = JSON.parse(await readFile(catalogPath, "utf-8"));
    if (content[opts.key] !== opts.value) {
      throw new Error(
        `Expected catalog key "${opts.key}" to have value "${opts.value}", but got "${content[opts.key]}"`,
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
