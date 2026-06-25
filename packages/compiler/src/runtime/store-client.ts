import { getActiveInstance } from "./store-core.js";

export const syncLocale = () => {
  const inst = getActiveInstance();
  const locales = inst.getLocales();
  if (locales.length === 0) return;

  // 1. Try to sync from URL pathname
  const pathname = window.location.pathname;
  if (pathname) {
    const parts = pathname.split("/").filter(Boolean);
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
