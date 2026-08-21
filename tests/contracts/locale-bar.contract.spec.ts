import { expect } from "vite-plus/test";
import {
  executeContract,
  localeControl,
  SWITCHER_SELECTOR,
  type Contract,
  type Lab,
  type LocaleSwitchAdapter,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/** The locales every example offers, in the order the bar renders them. */
const LOCALES = ["en", "ar", "es", "zh"];

/**
 * Read something out of the bar, and keep reading until it settles.
 *
 * Every read here is polled rather than taken once, for the reason the suite's
 * own guidance gives: `zintl(locale)` resolves — and with it the store and
 * `<html lang>` — *before* the app has repainted, so a single read after a click
 * races the render. It is the same trap `textEventually` exists to close, and it
 * showed up here exactly as predicted: two apps whose `render()` awaits a second
 * trust anchor passed alone and failed under a loaded machine.
 */
function bar<T>(lab: Lab, read: (nodes: Element[]) => T) {
  return expect.poll(() => lab.page.$$eval(`${SWITCHER_SELECTOR} [data-lang]`, read), {
    timeout: 15000,
    interval: 50,
  });
}

/**
 * Every example renders the same locale bar.
 *
 * This is a contract about the examples rather than about Zintl, and it exists
 * because the drift it prevents had already happened once. One concept — "switch
 * the locale" — had four different DOM shapes across the suite: a header band on
 * the Vite apps, a fixed pill row with its CSS copied into each component on the
 * Rsbuild ones, `.locale-switcher > .lang-btn` on `vanilla-spa`, and Tailwind
 * utilities on `vinext-basic`. Nothing failed, because nothing was checking; the
 * only cost showed up as seventeen manifests each carrying the same hand-written
 * `switchLocale`, matching buttons by the script their label happened to be
 * written in.
 *
 * So the shape is asserted where it is observable — in the rendered page, on
 * every project that claims `locale-switch`. What it checks is deliberately the
 * *contract* and not the styling: the controls exist, they are the declared
 * locales, exactly one is current, and the mark is present. How the bar looks is
 * CSS, and CSS is not what a test should pin.
 *
 * See `docs/examples-locale-bar.md`.
 */
export const localeBarContract: Contract<LocaleSwitchAdapter> = {
  name: "Locale Bar",
  description: "Verifies every example renders the same locale bar, with the Zintl mark",
  requires: ["spa", "locale-switch"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. The bar is there, and it offers exactly the declared locales — in order.
    await bar(lab, (nodes) => nodes.map((n) => n.getAttribute("data-lang"))).toEqual(LOCALES);

    // 2. `button` or `a` — the element follows the behaviour, and both are
    //    legitimate — but never a mix, which would mean two shapes in one bar.
    const tags = await lab.page.$$eval(`${SWITCHER_SELECTOR} [data-lang]`, (nodes) =>
      nodes.map((n) => n.tagName.toLowerCase()),
    );
    expect(new Set(tags).size).toBe(1);
    expect(["button", "a"]).toContain(tags[0]);

    // 3. Exactly one control is current, and it is the source locale on arrival.
    //    Asserting "exactly one" rather than "the right one is marked" is what
    //    catches a bar that marks every control, which reads correctly at a
    //    glance and is wrong.
    await bar(lab, (nodes) =>
      nodes.filter((n) => n.classList.contains("active")).map((n) => n.getAttribute("data-lang")),
    ).toEqual(["en"]);

    await bar(lab, (nodes) =>
      nodes
        .filter((n) => n.getAttribute("aria-current") === "true")
        .map((n) => n.getAttribute("data-lang")),
    ).toEqual(["en"]);

    // 4. The Zintl mark is in the bar, drawn in `currentColor` so it themes
    //    itself, and hidden from assistive tech — labelling it would put the
    //    brand name into every catalog in every locale.
    const mark = await lab.page.$$eval(".zintl-mark", (nodes) =>
      nodes.map((n) => ({
        hidden: n.getAttribute("aria-hidden"),
        usesCurrentColor: n.innerHTML.includes("currentColor"),
      })),
    );
    expect(mark).toEqual([{ hidden: "true", usesCurrentColor: true }]);

    // 5. Switching moves the mark of currency with it — the bar's one behaviour.
    await lab.page.click(localeControl("ar"));
    await lab.clock.waitForIdle();
    await lab.assert.localeCoherent("ar");

    await bar(lab, (nodes) =>
      nodes.filter((n) => n.classList.contains("active")).map((n) => n.getAttribute("data-lang")),
    ).toEqual(["ar"]);
  },
};

executeContract(localeBarContract, allManifests);
