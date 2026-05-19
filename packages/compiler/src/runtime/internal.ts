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
  type Catalogs,
  type Loader,
} from "./store.js";
import { _t } from "./resolver.js";
import { registerZintlLoader } from "./registry.js";

// Friendly alias for internal tests
export { _t as t };

export async function zintl(locale: string) {
  await setLocale(locale);
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
    if (config.loaders) {
      for (const [boundaryId, loader] of Object.entries(config.loaders)) {
        void registerLoader(boundaryId, loader);
      }
    }

    // 4. Full hydration (Async)
    if (config.locale) {
      await store.setLocale(config.locale);
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
};
