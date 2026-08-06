/**
 * @module zintl/macro
 *
 * The macro facade — everything you write in application code.
 *
 * These are compiler markers, not a runtime library. At build time the Zintl
 * plugin rewrites each call and each import in this module to its real runtime
 * equivalent, which is why the bodies you see here look like no-ops. They are:
 * the bodies are the fallback for an untransformed environment (a plain `tsc`
 * run, a unit test without the plugin), where the app must still work in the
 * source locale rather than crash.
 *
 * The plugin itself lives at `zintl/vite`, not here.
 */

/**
 * The i18n handle a resolved {@link zintl} anchor gives you.
 *
 * Rarely needed — most apps `await zintl(locale)` for the side effect and read
 * the locale later with {@link getLocale}. It is there for the cases where you
 * want to act on the boundary you just created.
 */
export interface ZintlInstance {
  /**
   * The locale at the moment this anchor resolved.
   *
   * A snapshot, not a live value: a later `setLocale` does not change it. Use
   * {@link getLocale} for the current locale.
   */
  readonly locale: string;
  /** Log translation misses and catalog loads for this boundary. */
  debug: boolean;
  /** Switch the active locale, loading any catalogs it needs. */
  setLocale(locale?: string | null): Promise<void>;
  /** Run `listener` on every locale or catalog change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Translate a key against this boundary. See {@link t}. */
  t(key: string, params?: Record<string, any>): string;
}

/**
 * Declare an internationalization boundary — the trust anchor.
 *
 * Awaiting `zintl()` sets the active locale and loads the catalogs for every
 * string reachable from this file. Everything downstream of it is extracted and
 * translated with no further annotation: no wrapper functions, no key maps.
 *
 * Every call is an **independent** anchor with its own catalog boundary and
 * hydration lifecycle, whether it sits at module level or inside a function. A
 * nested call opts out of any parent context rather than inheriting it, so
 * loading stays deterministic.
 *
 * What you pass decides how much work happens at runtime:
 *
 * - `zintl("ar")` — a static literal. The compiler inlines that catalog into the
 *   generated loader, so the boundary is ready with no network round-trip.
 * - `zintl(userLang)` — an expression. Catalogs load lazily for whichever locale
 *   is asked for.
 * - `zintl()` — no argument. Reads `document.documentElement.lang`.
 * - `zintl("*")` — every locale is a valid target. Together with `zintl()`, this
 *   is what the plugin looks for when auto-detecting `multiplex` builds.
 *
 * @param locale - The locale to activate. Omit to read it from the document.
 * @returns The boundary's i18n handle, once its catalogs have loaded.
 *
 * @example
 * ```ts
 * import { zintl } from "zintljs/macro";
 *
 * await zintl(new URLSearchParams(location.search).get("lang") ?? "en");
 *
 * // Extracted automatically — no wrapper needed.
 * document.querySelector("#app")!.innerHTML = `<h1>Welcome back!</h1>`;
 * ```
 *
 * @zintl-macro
 */
export async function zintl(_locale?: string): Promise<ZintlInstance> {
  // LOGIC-FREE: a marker for the compiler, which replaces this call outright.
  // Untransformed, it yields an inert handle so the source locale still renders.
  return {
    locale: "",
    debug: false,
    setLocale: () => Promise.resolve(),
    subscribe: () => () => {},
    t: (key: string) => key,
  };
}

/**
 * Translate an explicit key.
 *
 * The escape hatch, not the main road: Zintl extracts string literals, template
 * literals, JSX and HTML on its own, so reach for `t()` only when the string is
 * not in the source — a key assembled at runtime, or one arriving from data.
 *
 * `params` fills the `{name}` placeholders in a message, and feeds the plural
 * and select branches the compiler bakes from the catalog's ZCU form. Context
 * variables bound with `@zintl-pass` arrive the same way, which is how a target
 * language can vary on gender or count that the source string never mentions.
 *
 * @param key - The message key, as it appears in the catalog.
 * @param _params - Values for the message's placeholders and grammatical branches.
 * @returns The translation for the active locale, or `key` itself if there is none.
 *
 * @example
 * ```ts
 * t("cart.items", { count: cart.length })
 * t(`status.${order.state}`)
 * ```
 *
 * @zintl-macro
 */
export function t(key: string, _params: Record<string, any> = {}): string {
  // LOGIC-FREE: a marker for the compiler.
  // Untransformed, it returns the key as-is.
  return key;
}

/**
 * The locale currently active.
 *
 * The plugin rewrites this import to the real runtime binding, so it reflects
 * the live store — including a locale set after the anchor resolved. Returns
 * `""` when no boundary has been established yet.
 */
export function getLocale(): string {
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_active) {
    return (globalThis as any).__zintl_active.locale;
  }
  return "";
}

/**
 * Switch the active locale, loading whatever catalogs it needs.
 *
 * Resolves once the new locale is in effect. If the catalogs are already
 * present — inlined for a static anchor, or loaded earlier — the switch applies
 * synchronously and subscribers see it before the promise settles.
 *
 * Passing `null` or `undefined` is a no-op, so a value straight from a router or
 * a query string needs no guard.
 *
 * @example
 * ```ts
 * document.querySelector("#lang")!.addEventListener("change", (e) => {
 *   void setLocale((e.target as HTMLSelectElement).value);
 * });
 * ```
 */
export function setLocale(_locale?: string | null): Promise<void> {
  return Promise.resolve();
}

/**
 * Run `listener` whenever the locale or the loaded catalogs change.
 *
 * The building block for wiring Zintl into a UI framework by hand. Call the
 * returned function to unsubscribe. Framework integrations built from the
 * The built-in facets already do this for you — React components, for instance, are
 * re-rendered through `useSyncExternalStore` without any subscription of yours.
 *
 * @returns An unsubscribe function.
 */
export function subscribe(_listener: () => void): () => void {
  return () => {};
}

/**
 * A counter that increments on every locale or catalog change.
 *
 * The snapshot half of a `useSyncExternalStore`-style pairing with
 * {@link subscribe}: compare it to know whether anything translated has moved.
 */
export function getStoreVersion(): number {
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_active) {
    return (globalThis as any).__zintl_active.version;
  }
  return 0;
}
