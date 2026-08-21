import type { Lab } from "../environment/lab.js";

/**
 * The locale bar every example renders, described once.
 *
 * Before it existed, seventeen manifests each carried the same four-branch
 * `switchLocale` — `lab.page.click("button:has-text('العربية')")` and three more
 * like it — because there was no shared contract about what a switcher *is*.
 * Matching on the visible label was the only option left, and it is the worst
 * one available: it depends on which script a locale's name happens to be
 * written in, it would match any other button on the page carrying that text,
 * and it says nothing when it fails.
 *
 * Every example now renders the same bar (`docs/examples-locale-bar.md`), so the
 * selector can name the thing rather than describe how it looks.
 */

/** The container the bar's locale controls live in. */
export const SWITCHER_SELECTOR = "#switcher";

/**
 * One locale's control.
 *
 * Element-agnostic on purpose. An app that switches locale at runtime renders a
 * `<button>`; one whose locales are baked into separate documents renders an
 * `<a>`, because that switch really is a navigation. `data-lang` is what both
 * have in common, and it is the only part a test should depend on.
 */
export function localeControl(locale: string): string {
  return `${SWITCHER_SELECTOR} [data-lang="${locale}"]`;
}

/** Click the bar's control for `locale`. */
export async function clickLocaleBar(lab: Lab, locale: string): Promise<void> {
  await lab.page.click(localeControl(locale));
}
