/**
 * Telling Zintl's own artifact writes apart from a user's edit.
 *
 * The predicate used to be a clock: `writingFiles` holds a path for
 * `WRITE_GUARD_DELAY_MS` after a write, and anything the watcher reported inside
 * that window was Zintl's echo. ZDB Corollary D1a says plainly that a window is
 * never a guard, and this is what that costs when it is used as one.
 *
 * Under parallel load the echo of a catalog write arrives *after* the window
 * closes. `computeHotUpdatePlan` then accepts it as a user edit, and
 * `src/i18n/index.html.translations.json` maps back to the `index.html`
 * boundary — which the plan answers with a full page reload. So the compiler
 * reloads the browser because it wrote a file it decided to write.
 *
 * Wasted work most of the time. Not in `syntax-recovery`, where the reload lands
 * on a deliberately broken entry: the page comes back with no Zintl runtime and
 * no module registered for the entry, and the recovery edit that follows arrives
 * as a hot `update` that nothing left in the page can accept.
 *
 * `vanilla-spa-basic` alone, because it is the only project whose `headingFile`
 * *is* the client entry — every other one breaks a component, so the reloaded
 * page still boots its entry and the runtime is there to take the recovery.
 */
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";

let root: string;
let compiler: ZintlCompiler;
let catalog: string;

/**
 * What the guard's `setTimeout` does when it fires, without waiting for it.
 *
 * Sleeping `WRITE_GUARD_DELAY_MS` here would test the timer rather than the
 * thing the timer was standing in for, and would put half a second on every run.
 */
function windowLapses() {
  compiler.io.writingFiles.clear();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zintl-self-write-"));
  compiler = new ZintlCompiler(
    { capabilities: emptyCapabilities(), locales: ["en", "ar"], sourceLocale: "en" } as never,
    root,
    true,
  );
  catalog = join(root, "index.html.translations.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("known-content identity", () => {
  it("recognises its own write once the time window has lapsed", async () => {
    await compiler.safeWriteFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }));

    expect(await compiler.isUnchangedContent(catalog)).toBe(true);

    windowLapses();

    // The event the watcher would have delivered late. This is the case the
    // clock got wrong, and the whole reason the predicate changed.
    expect(await compiler.isUnchangedContent(catalog)).toBe(true);
  });

  it("does not mistake a hand-edit for its own write", async () => {
    await compiler.safeWriteFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }));
    windowLapses();

    await writeFile(catalog, JSON.stringify({ ar: { greeting: "أهلا" } }), "utf-8");

    expect(await compiler.isUnchangedContent(catalog)).toBe(false);
  });

  it("compares the file as it is now, not as the event described it", async () => {
    await compiler.safeWriteFile(catalog, JSON.stringify({ ar: { greeting: "one" } }));
    windowLapses();
    await compiler.safeWriteFile(catalog, JSON.stringify({ ar: { greeting: "two" } }));
    windowLapses();

    // Two writes, and the watcher is still reporting the first. What is on disk
    // is the second, and both are ours — the answer must not depend on which
    // event this is.
    expect(await compiler.isUnchangedContent(catalog)).toBe(true);
  });

  it("survives the formatter rewriting the file after the write", async () => {
    await compiler.safeWriteFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }));
    windowLapses();

    /**
     * `formatFile` shells out to whatever the project has, so what lands on disk
     * is a third string this compiler never composed. Stood in for here by
     * reformatting the file the way a formatter would; the signature recorded
     * after `formatFile` is what has to cover it.
     */
    const written = await readFile(catalog, "utf-8");
    await writeFile(catalog, `${written.trim()}\n\n`, "utf-8");

    expect(await compiler.isUnchangedContent(catalog)).toBe(true);
  });

  it("stops recognising content once an event for that path was taken as genuine", async () => {
    const ours = JSON.stringify({ ar: { greeting: "مرحبا" } });
    await compiler.safeWriteFile(catalog, ours);
    windowLapses();

    // A hand-edit, accepted as genuine by the host — which is where
    // `forgetSelfWrite` is called.
    await writeFile(catalog, JSON.stringify({ ar: { greeting: "أهلا" } }), "utf-8");
    expect(await compiler.isUnchangedContent(catalog)).toBe(false);
    compiler.forgetKnownContent(catalog);

    /**
     * Reverting by hand to exactly what the compiler last wrote is a real edit,
     * and content identity is the one way this could be *stickier* than the
     * window it replaces. Forgetting on acceptance is what keeps it from being.
     */
    await writeFile(catalog, `${ours}\n`, "utf-8");
    expect(await compiler.isUnchangedContent(catalog)).toBe(false);
  });

  it("says nothing about a path it has neither read nor written", async () => {
    expect(await compiler.isUnchangedContent(join(root, "src/main.ts"))).toBe(false);
  });

  it("declines an event for a file it only ever read, while the content still matches", async () => {
    /**
     * The case that actually strands `syntax-recovery`, and the one no
     * write-authorship test can reach: the catalog was put there by something
     * else — a worker copy settling, an initial scan draining — and the watcher
     * reports it seconds later. Nothing changed, so nothing should be delivered,
     * and above all the browser should not be reloaded.
     */
    await writeFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }, null, 2), "utf-8");
    await compiler.io.readFile(catalog);
    windowLapses();

    expect(await compiler.isUnchangedContent(catalog)).toBe(true);
  });

  it("still sees a real edit to a file it had only read", async () => {
    await writeFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }, null, 2), "utf-8");
    await compiler.io.readFile(catalog);
    windowLapses();

    await writeFile(catalog, JSON.stringify({ ar: { greeting: "أهلا" } }, null, 2), "utf-8");
    expect(await compiler.isUnchangedContent(catalog)).toBe(false);
  });

  it("does not let a later read move the baseline off a pending edit", async () => {
    /**
     * The restriction that makes the read baseline safe. A translator edits a
     * catalog; the compiler re-reads it for its own reasons before the watcher
     * event arrives. If that read moved the baseline, the event would be
     * dismissed as "nothing changed" and the edit would never reach the page.
     */
    await writeFile(catalog, JSON.stringify({ ar: { greeting: "مرحبا" } }, null, 2), "utf-8");
    await compiler.io.readFile(catalog);
    windowLapses();

    await writeFile(catalog, JSON.stringify({ ar: { greeting: "أهلا" } }, null, 2), "utf-8");
    await compiler.io.readFile(catalog); // the compiler's own re-read

    expect(await compiler.isUnchangedContent(catalog)).toBe(false);
  });
});
