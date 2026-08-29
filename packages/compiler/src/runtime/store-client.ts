import { getActiveInstance } from "./store-core.js";

/**
 * The host's public base path, folded in at generation time.
 *
 * `"/"` for an app served from a domain root, which is most of them, and the
 * repository name for a GitHub Pages project site — `"/zintl/"`. Without it the
 * lookup below reads the *base* as the locale: on `/zintl/ar/guide` the first
 * path segment is `zintl`, which names no locale, so a site deployed under a
 * sub-path silently served every reader its source language no matter what URL
 * they opened.
 */
declare const __ZINTL_BASE__: string;

export const syncLocale = () => {
  const inst = getActiveInstance();
  const locales = inst.getLocales();
  if (locales.length === 0) return;

  // 1. Try to sync from URL pathname, below the base the app is served from
  const pathname = window.location.pathname;
  if (pathname) {
    const base = __ZINTL_BASE__;
    const belowBase =
      base && base !== "/" && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    const parts = belowBase.split("/").filter(Boolean);
    if (parts.length > 0 && locales.includes(parts[0])) {
      if (inst.locale !== parts[0]) {
        void inst.setLocale(parts[0]);
        return;
      }
    }
  }

  // 2. Try to sync from document element lang
  if (typeof document !== "undefined" && document.documentElement) {
    const docLang = document.documentElement.lang;
    if (docLang && locales.includes(docLang) && inst.locale !== docLang) {
      void inst.setLocale(docLang);
    }
  }
};

if (typeof window !== "undefined") {
  // Listen to popstate and history monkey-patch
  window.addEventListener("popstate", syncLocale);

  // oxlint-disable-next-line typescript/unbound-method
  const origPush = window.history.pushState;
  if (origPush) {
    window.history.pushState = function (...args) {
      origPush.apply(this, args);
      syncLocale();
    };
  }

  // oxlint-disable-next-line typescript/unbound-method
  const origReplace = window.history.replaceState;
  if (origReplace) {
    window.history.replaceState = function (...args) {
      origReplace.apply(this, args);
      syncLocale();
    };
  }

  // MutationObserver for documentElement.lang changes
  if (
    typeof MutationObserver !== "undefined" &&
    typeof document !== "undefined" &&
    document.documentElement
  ) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "lang") {
          syncLocale();
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }

  // Initial sync
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncLocale);
  } else {
    syncLocale();
  }
}
