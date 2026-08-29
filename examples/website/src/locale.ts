/**
 * The four locales, and the small amount of arithmetic the site does on them.
 *
 * **Every locale is prefixed in the path** — `/en/guide/…` exactly as much as
 * `/ar/guide/…` — because that is the shape Zintl's client store already reads.
 * `syncLocale` in the runtime's `store-client.ts` takes the *first path segment*
 * and adopts it if it names a locale, on `popstate` and on every patched
 * `pushState`. Leaving the default locale unprefixed would make that lookup fall
 * through to its second source, `<html lang>` — which during a back navigation
 * still holds the locale being navigated *away from*. So `/ar/guide/x` → back →
 * `/guide/x` would restore Arabic under an English URL.
 *
 * Prefixing all four makes the runtime's own rule sufficient rather than
 * something to work around, which is why the prettier unprefixed English URL is
 * not worth having here.
 */
const LOCALES = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
] as const;

export type LocaleId = (typeof LOCALES)[number]["id"];

export const DEFAULT_LOCALE: LocaleId = "en";

/**
 * The bar's labels are written in their own language and must stay that way, so
 * they are deliberately object fields: `obj:field` is not a default extraction
 * target, and nothing here names this binding in `additionalTargets`. That is
 * the same reason the Vue example's switcher needs no `@zintl-ignore`.
 */
export const localeBar: readonly { id: LocaleId; name: string }[] = LOCALES;

const IDS: readonly string[] = LOCALES.map((l) => l.id);

function isLocale(value: string | undefined): value is LocaleId {
  return value !== undefined && IDS.includes(value);
}

/** The locale a URL is asking for, defaulting rather than failing. */
export function localeFromPath(pathname: string): LocaleId {
  const first = pathname.split("/").filter(Boolean)[0];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

/** Whether a path already names a locale in its first segment. */
export function isLocalePath(pathname: string): boolean {
  return isLocale(pathname.split("/").filter(Boolean)[0]);
}

/** The same page, in another language. */
export function swapLocale(pathname: string, locale: LocaleId): string {
  const parts = pathname.split("/").filter(Boolean);
  if (isLocale(parts[0])) parts[0] = locale;
  else parts.unshift(locale);
  return "/" + parts.join("/");
}
