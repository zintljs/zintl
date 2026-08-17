import type { Lab } from "../environment/lab.js";

/**
 * A registered boundary the delivery contracts can drive the receiver through.
 *
 * `carriesKey` says whether the probe is the boundary that actually holds the
 * app's heading, or a stand-in. The distinction is recorded rather than hidden:
 * a stand-in still proves the rule, because Axiom D1 and the push/pull join are
 * properties of the receiver and not of any particular boundary — but it proves
 * it one step further from the string the page renders, and a reader of a green
 * run deserves to know which they got.
 */
export type DeliveryProbe =
  | { ok: true; boundaries: string[]; carriesKey: boolean }
  | { ok: false; why: string };

/**
 * Pick a boundary for `delivery-ordering` and `delivery-refresh` to drive.
 *
 * Both contracts used to find their probe by scanning `store.catalogs[locale]`
 * for the boundary carrying `adapter.initialHeadingText`, and abort when none
 * did. That reads as a search for *the* boundary and is really an assumption
 * about **how the app was chunked** — that the asserted string arrives in a
 * registered catalog rather than one the manager inlines.
 *
 * It does not hold, and the counter-example is not exotic. On
 * `rsbuild-vanilla-mpa` the heading lives in the entry's own boundary, which the
 * manager inlines for the active locale; the source locale is ghosted, so the
 * boundary is never registered and the scan finds nothing. Both contracts
 * aborted on an app where delivery demonstrably works — inspected live, all
 * three boundaries present under `ar` and both documents fully translated. The
 * project passed `hmr` 0 runs in 10 and still could not claim the capability,
 * because two contracts gated behind it refused to run.
 *
 * So the search falls back to any registered boundary instead of giving up. It
 * fails only when the store holds no catalogs at all for the active locale,
 * which is a real failure and now says so precisely.
 */
export async function pickDeliveryProbe(lab: Lab, messageKey: string): Promise<DeliveryProbe> {
  return await lab.page.evaluate(
    ({ key }): DeliveryProbe => {
      const store = (
        globalThis as {
          __zintl_current_instance?: {
            locale: string;
            catalogs: Record<string, Record<string, Record<string, unknown>>>;
          };
        }
      ).__zintl_current_instance;
      if (!store) return { ok: false, why: "no runtime on the page" };

      const locale = store.locale;
      const registered = Object.keys(store.catalogs[locale] ?? {});
      if (registered.length === 0) {
        return {
          ok: false,
          why:
            `the store holds no registered catalogs for locale ${JSON.stringify(locale)}, ` +
            `so there is no boundary to drive the receiver through`,
        };
      }

      const carrying = registered.filter((b) => key in (store.catalogs[locale]?.[b] ?? {}));
      if (carrying.length > 0) return { ok: true, boundaries: carrying, carriesKey: true };

      // Sorted, so which stand-in gets picked is a function of the app rather
      // than of catalog insertion order.
      return { ok: true, boundaries: [[...registered].sort()[0]], carriesKey: false };
    },
    { key: messageKey },
  );
}
