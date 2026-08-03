import { executeContract, type Contract, type SsrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Request scoping under concurrency (`docs/spec/ZDB.md` §3).
 *
 * The store is request-scoped through `AsyncLocalStorage`, but several things
 * around it are not: `globalThis.__zintl_active` is assigned inside the request
 * scope, and `getActiveInstance()` falls back to it whenever the async context
 * is unavailable. Every existing SSR contract issues one request at a time,
 * which is exactly the condition under which that fallback is indistinguishable
 * from the correct path — a second request has to be in flight for the
 * difference to exist at all.
 *
 * The shape of the failure is a page served in the wrong language: the response
 * is complete, well-formed, and belongs to somebody else. Nothing throws.
 *
 * Method: measure each locale uncontended, then interleave them and require
 * every response to still match its own baseline. Comparing against a captured
 * baseline rather than hard-coded strings keeps this contract from encoding the
 * example's copy, and makes a contaminated response point at *which* locale
 * bled into it.
 */
const ROUNDS = 6;

function headingOf(html: string): string | undefined {
  return html
    .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]*>/g, "")
    .trim();
}

function langOf(html: string): string | undefined {
  return html.match(/<html[^>]*\slang=["']([^"']+)["']/i)?.[1];
}

export const ssrIsolationContract: Contract<SsrAdapter> = {
  name: "SSR Request Isolation",
  description:
    "Verifies concurrent requests for different locales never observe each other's state",
  requires: ["ssr"],
  /**
   * **Verified falsifiable**, which for this contract is the whole question.
   *
   * It passes. To establish that this means something, request scoping was
   * deliberately broken — the `AsyncLocalStorage` lookup in `getActiveInstance`
   * was disabled so every read fell through to the process-global
   * `globalThis.__zintl_active` — and the contract failed on `ssr-streaming`
   * with 18 of 24 responses serving Arabic to English, Spanish and Chinese
   * requests. The four example projects kept passing, correctly: they render
   * synchronously and genuinely cannot leak.
   *
   * That split is the reason the fixture exists. A synchronous render leaves no
   * window between entering the request scope and reading the store, so
   * request-scoped and process-global reads are indistinguishable and this
   * contract would pass no matter what the runtime did. An earlier version of
   * this file shipped `pending` for exactly that reason.
   */
  async execute(lab, adapter) {
    const locales = ["en", "ar", "es", "zh"];

    // Warm-up: the first request per locale pays for compilation, and a
    // baseline captured mid-compile would measure the compiler, not isolation.
    for (const locale of locales) {
      await fetch(`${lab.url}${adapter.ssrPath(locale)}`).then((r) => r.text());
    }

    // 1. Uncontended baseline — what each locale looks like with nothing racing.
    const baseline: Record<string, { heading?: string; lang?: string }> = {};
    for (const locale of locales) {
      const html = await fetch(`${lab.url}${adapter.ssrPath(locale)}`).then((r) => r.text());
      baseline[locale] = { heading: headingOf(html), lang: langOf(html) };

      if (!baseline[locale].heading) {
        throw new Error(
          `Could not read a heading from the "${locale}" response, so isolation cannot be ` +
            `measured against it. The contract needs a baseline before it can detect drift.`,
        );
      }
    }

    /**
     * The baselines must differ from each other, or this contract proves
     * nothing: if every locale rendered identically, contamination would be
     * invisible and the assertions below would pass vacuously.
     */
    const distinct = new Set(locales.map((l) => baseline[l].heading));
    if (distinct.size < 2) {
      throw new Error(
        `Every locale rendered the same heading (${JSON.stringify([...distinct])}), so a ` +
          `cross-request leak would be undetectable here. Either the example is not actually ` +
          `translated, or SSR is already serving one locale for every request.`,
      );
    }

    // 2. Interleave. One in flight at a time is precisely the case where a
    //    process-global fallback behaves identically to a request-scoped read.
    const schedule: string[] = [];
    for (let round = 0; round < ROUNDS; round++) schedule.push(...locales);

    const responses = await Promise.all(
      schedule.map(async (locale) => ({
        locale,
        html: await fetch(`${lab.url}${adapter.ssrPath(locale)}`).then((r) => r.text()),
      })),
    );

    // 3. Every response must still be its own.
    const leaks: string[] = [];
    for (const { locale, html } of responses) {
      const heading = headingOf(html);
      const lang = langOf(html);

      if (heading !== baseline[locale].heading) {
        const impostor = locales.find((l) => baseline[l].heading === heading);
        leaks.push(
          `  ${locale}: heading was ${JSON.stringify(heading)}` +
            (impostor ? ` — that is ${impostor}'s content` : " — matches no locale's baseline") +
            `, expected ${JSON.stringify(baseline[locale].heading)}`,
        );
      }

      if (lang !== baseline[locale].lang) {
        leaks.push(
          `  ${locale}: lang was ${JSON.stringify(lang)}, expected ` +
            `${JSON.stringify(baseline[locale].lang)}`,
        );
      }
    }

    if (leaks.length > 0) {
      throw new Error(
        `${leaks.length} of ${responses.length} concurrent responses carried another request's ` +
          `state:\n${leaks.slice(0, 10).join("\n")}\n\n` +
          `Each response is complete and well-formed — it simply belongs to somebody else, ` +
          `which is why nothing throws and why serial requests never show this.`,
      );
    }
  },
};

executeContract(ssrIsolationContract, allManifests);
