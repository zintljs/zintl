import {
  setLocale,
  getLocale,
  addCatalogs,
  subscribe,
  registerLoader,
  unregisterLoader,
  getActiveInstance,
  setActiveInstance,
  I18nStore,
  runInRequestScope,
  type Catalogs,
  type Loader,
} from "./store.js";
import { _t } from "./resolver.js";
import { registerZintlLoader } from "./registry.js";

// Friendly alias for internal tests
export { _t as t };

export async function zintl(locale?: string) {
  const activeLocale =
    locale || (typeof document !== "undefined" ? document.documentElement.lang : "");
  if (activeLocale) {
    await setLocale(activeLocale);
  }
}

export interface I18nInstanceConfig {
  locale?: string;
  catalogs?: Catalogs;
  loaders?: Record<string, Loader>;
  debug?: boolean;
}

/**
 * Loads and configures the i18n instance for a boundary.
 * Registers loaders and merges new catalogs into the existing state.
 *
 * INTERNAL: Targeted by the compiler after zintl() macro expansion.
 */
export async function loadI18nInstance(config: I18nInstanceConfig = {}) {
  // Create a new store for this instance
  const store = new I18nStore();

  // Temporarily set as active to perform initialization
  setActiveInstance(store);

  if (typeof globalThis !== "undefined") {
    (globalThis as any).__zintl_active = store;
  }

  try {
    // 1. Config injection (Synchronous)
    if (config.debug !== undefined) store.debug = config.debug;

    // 2. Set language state (Synchronous part)
    if (config.locale) {
      store.locale = config.locale;
    }

    // 3. Merge hardcoded catalogs (Synchronous)
    if (config.catalogs) {
      store.addCatalogs(config.catalogs);
    }

    // 4. Register loaders (Synchronous Boost)
    const promises: Promise<any>[] = [];
    if (config.loaders) {
      for (const [boundaryId, loader] of Object.entries(config.loaders)) {
        const res = registerLoader(boundaryId, loader);
        if (res && typeof res.then === "function") {
          promises.push(res);
        }
      }
    }

    // 4. Full hydration (Async)
    if (config.locale) {
      promises.push(store.setLocale(config.locale));
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  } finally {
    // Return to pool or maintain active if needed
  }

  return {
    locale: store.locale,
    get debug() {
      return store.debug;
    },
    set debug(value: boolean) {
      store.debug = value;
    },
    setLocale: (l?: string | null) => store.setLocale(l),
    subscribe: (cb: () => void) => store.subscribe(cb),
    t: (key: string, params?: Record<string, any>) => {
      const prev = getActiveInstance();
      setActiveInstance(store);
      try {
        return _t(key, params);
      } finally {
        setActiveInstance(prev);
      }
    },
  };
}

export {
  setLocale,
  getLocale,
  addCatalogs,
  subscribe,
  _t,
  registerZintlLoader,
  registerLoader,
  unregisterLoader as unregisterZintlLoader,
  runInRequestScope,
};
