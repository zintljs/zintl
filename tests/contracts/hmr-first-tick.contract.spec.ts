import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * The update is correct on the **first** render tick, never blank (ZHMR §4.4, §6).
 *
 * **The gap this closes is in the assertion style, not in the coverage list.**
 * Every hot-update contract here asserts with `textEventually`, which polls
 * until the expected text appears. That is the right tool for "did the update
 * arrive" and it is structurally blind to "what did the user see on the way" —
 * a heading that goes `Get started` → `` → `HMR works!` polls green, because
 * the poller simply misses the empty frame or ignores it as not-yet-arrived.
 *
 * ZHMR §6 lists "Blank/Empty Rendering on First HMR Update" as a known failure
 * mode, and it is not hypothetical: `delivery-refresh` exists because a pull
 * that answered from a stale catalog rendered *permanently* blank, since Zintl
 * has no source-locale fallback and every key the incoming catalog was about to
 * supply resolved to `""`. The permanent version of that bug had a contract
 * written for it. The transient version — one blank frame, then correct — had
 * nothing, and is the same defect with better luck.
 *
 * §4.4 is precise about why a blank frame must not happen: the content module
 * calls `addCatalogs` **synchronously as it evaluates**, and module evaluation
 * completes before the framework's own update callback runs, so the store is
 * already populated by the time anything re-renders. A blank frame means that
 * ordering broke.
 *
 * **Deliberately its own contract rather than an assertion inside `hmr`.**
 * Thirteen projects claim `hmr`, and folding a second, subtler guarantee into
 * the contract they claim it through would mean one flaky frame-capture takes
 * the suite's primary hot-update signal down with it. Separate contracts fail
 * separately, and a capability is only as useful as the question it answers.
 *
 * Records nothing on a host that answers the edit with a full reload — the
 * observer dies with the document, and a reload is a different mechanism with
 * a different guarantee (`hmr-growth` is where reloads are asserted). Reported
 * as such rather than passed silently.
 */

const EDITED = "First tick works!";

export const hmrFirstTickContract: Contract<HmrAdapter> = {
  name: "HMR First Tick",
  description: "Verifies a hot update never renders an empty or foreign intermediate frame",
  /**
   * `hmr-warm`, because this contract observes **frames**, and a project that
   * answers an edit with a full reload has none to observe — the document, the
   * observer and the log go together. Measured: the four Rspack projects
   * without client reactivity replace the document, which L-035 establishes as
   * correct rather than broken, so failing them here would be reporting a
   * documented host difference as a defect.
   */
  requires: ["hmr", "hmr-warm"],
  /**
   * **Green on all nine, 0 failures in 10 runs — and the one red it used to
   * report was mine, not the product's.**
   *
   * `lazy-boundary` recorded `"Lazy colony"` → `""` → `"First tick works!"`,
   * which was written up as ZHMR §6's named failure mode and entered in the
   * ledger as a real defect. It was neither. The probe read the heading with
   * `querySelector(sel)?.textContent ?? ""`, which returns `""` for an element
   * that is **absent** as readily as for one that is empty — and this app
   * clears its container, `await`s a dynamic import, and paints. During that
   * await there is no heading in the document at all.
   *
   * The two states are now distinguished, and only the one §6 describes fails:
   * the element present with empty text, because `_t` resolved against a
   * catalog that had not arrived and there is no source-locale fallback.
   *
   * Kept as a comment rather than quietly corrected, because the failure was
   * instructive: a contract that cannot tell "not rendered yet" from "rendered
   * as nothing" will invent defects in any app that repaints asynchronously,
   * and it took a second measurement to notice.
   */
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    /**
     * Observes `document.body` rather than the element itself: a framework may
     * replace the node instead of mutating its text, and an observer bound to
     * the old node would see nothing and report a clean run.
     */
    await lab.page.evaluate((selector) => {
      const scope = globalThis as unknown as {
        __zintl_tick_log?: string[];
        __zintl_tick_observer?: MutationObserver;
      };
      const log: string[] = [];
      scope.__zintl_tick_log = log;

      const ABSENT = "\u0000absent";
      const readNow = () => {
        const el = document.querySelector(selector);
        // Absent and empty are different states, and conflating them is what
        // made this contract report a defect that was not there. See below.
        return el ? (el.textContent ?? "") : ABSENT;
      };
      log.push(readNow());

      const observer = new MutationObserver(() => {
        const text = readNow();
        if (log[log.length - 1] !== text) log.push(text);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });

      // Held on the global deliberately: an observer reachable only from its own
      // registration is collectable, and a collected observer reports a clean
      // run for every project.
      scope.__zintl_tick_observer = observer;
    }, adapter.headingSelector);

    await lab.fs.edit(adapter.headingFile, (content) => {
      if (!content.includes(adapter.initialHeadingText)) {
        throw new Error(
          `Heading text "${adapter.initialHeadingText}" not found in file: ${adapter.headingFile}`,
        );
      }
      return content.replace(adapter.initialHeadingText, EDITED);
    });

    await lab.assert.textEventually(adapter.headingSelector, EDITED);

    const frames = await lab.page.evaluate(
      () => (globalThis as unknown as { __zintl_tick_log?: string[] }).__zintl_tick_log ?? null,
    );

    if (frames === null) {
      throw new Error(
        `The frame log did not survive the update, which means the document was replaced — ` +
          `this project answered a plain string edit with a full page reload rather than a hot ` +
          `replacement. ZHMR §4.1 puts a source string edit on the Fast Replacement path.`,
      );
    }

    /**
     * **An absent element is not a blank render, and telling them apart is the
     * whole value of this contract.**
     *
     * `document.querySelector(sel)?.textContent ?? ""` returns `""` for both,
     * and on that reading `lazy-boundary` looked like ZHMR §6's named failure —
     * recorded as a product defect, wrongly. The real sequence is
     * `"Lazy colony"` → *element absent* → `"First tick works!"`, because the
     * app clears its container, `await`s a dynamic import, and paints. During
     * the await there is no heading in the document at all. Any app that clears
     * before an await does this, and no translation was involved.
     *
     * What §6 describes is the other state: the element is **there** and its
     * text is empty, because `_t` resolved a key against a catalog that had not
     * arrived and Zintl has no source-locale fallback. That is what stays
     * asserted.
     */
    const ABSENT = "\u0000absent";
    const blank = frames.filter((f) => f !== ABSENT && f.trim() === "");
    if (blank.length > 0) {
      throw new Error(
        `The heading rendered empty ${blank.length} time(s) during the update.\n\n` +
          `Frames, in order: ${frames.map((f) => JSON.stringify(f)).join(" → ")}\n\n` +
          `ZHMR §4.4: the content module calls addCatalogs() synchronously as it evaluates, and ` +
          `that completes before the framework's update callback runs — so the store is already ` +
          `populated by the first re-render. An empty frame means the resolver ran against a ` +
          `catalog that had not been replaced yet, and with no source-locale fallback the miss ` +
          `renders as nothing at all (ZHMR §6).`,
      );
    }

    const foreign = frames.filter(
      (f) => f !== ABSENT && f !== adapter.initialHeadingText && f !== EDITED,
    );
    if (foreign.length > 0) {
      throw new Error(
        `The heading passed through ${foreign.length} value(s) that are neither the old text nor ` +
          `the new one: ${foreign.map((f) => JSON.stringify(f)).join(", ")}.\n\n` +
          `Full sequence: ${frames.map((f) => JSON.stringify(f)).join(" → ")}`,
      );
    }
  },
};

executeContract(hmrFirstTickContract, allManifests);
