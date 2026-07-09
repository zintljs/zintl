declare const process: any;

export type Catalog = Record<string, string | Function>;
export type BoundaryCatalogs = Record<string, Catalog>;
export type Catalogs = Record<string, BoundaryCatalogs>;
export type LoaderResult = Catalog | BoundaryCatalogs | Promise<Catalog | BoundaryCatalogs>;
export type Loader = (locale: string) => LoaderResult;

export let storeStorage: any = null;
export function setStoreStorage(storage: any) {
  storeStorage = storage;
}

export let runInRequestScope = <T>(
  _urlOrReq: any,
  _locales: string[],
  _defaultLocale: string,
  callback: () => T,
): any => {
  return callback();
};

export function setRunInRequestScope(fn: any) {
  runInRequestScope = fn;
}

export class I18nStore {
  locale: string = "";
  sourceLocale: string = "en";
  catalogs: Catalogs = {};
  locales: string[] = [];
  debug: boolean = (typeof process !== "undefined" && process.env.ZINTL_DEBUG === "true") || false;
  pendingBoundaries = new Set<string>();
  pendingPromises: Promise<any>[] = [];
  version: number = 0;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof document !== "undefined" && document.documentElement) {
      this.locale = document.documentElement.lang || "";
    }
    if (!this.locale && typeof window !== "undefined") {
      try {
        this.locale = localStorage.getItem("zintl-locale") || "";
      } catch {}
    }
    if (!this.locale) {
      try {
        if (storeStorage) {
          const active = storeStorage.getStore();
          if (active && active !== this) {
            this.locale = active.locale;
          }
        }
      } catch {}
    }
    if (typeof window !== "undefined" && (window as any).__zintl_baked_catalogs) {
      this.addCatalogs((window as any).__zintl_baked_catalogs);
    }
  }

  getLocales(): string[] {
    if (
      this.locales.length === 0 &&
      typeof window !== "undefined" &&
      (window as any).__zintl_locales
    ) {
      this.locales = (window as any).__zintl_locales;
    }
    return this.locales;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((l) => l());
  }

  addCatalogs(newCatalogs: Catalogs) {
    let changed = false;
    for (const [locale, boundaries] of Object.entries(newCatalogs)) {
      if (!this.catalogs[locale]) {
        this.catalogs[locale] = {};
      }
      for (const [boundaryId, messages] of Object.entries(boundaries)) {
        if (!this.catalogs[locale][boundaryId]) {
          this.catalogs[locale][boundaryId] = {};
        }
        for (const [key, value] of Object.entries(messages as Catalog)) {
          if (this.catalogs[locale][boundaryId][key] !== value) {
            this.catalogs[locale][boundaryId][key] = value;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(
          "[Zintl] Catalogs updated:",
          Object.keys(newCatalogs).flatMap((l) =>
            Object.keys(newCatalogs[l]).map((b) => `${l}/${b}`),
          ),
        );
      }
      this.notify();
    }
  }

  async setLocale(locale: string | null | undefined) {
    if (!locale) return;

    if (typeof window !== "undefined") {
      if ((window as any).__zintlApplyHtml) {
        (window as any).__zintlApplyHtml(locale);
      }
      try {
        localStorage.setItem("zintl-locale", locale);
      } catch {}
    }

    if (this.locale === locale && Object.keys(this.catalogs[locale] || {}).length > 0) {
      return;
    }

    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
      console.debug(`[Zintl] Switching to locale: ${locale}`);
    }
    this.locale = locale;

    const activePromises: Promise<void>[] = [];

    for (const [boundaryId, loader] of globalRegistry.entries()) {
      try {
        const result = loader(locale);
        const processResult = (res: Catalog | BoundaryCatalogs) => {
          if (!res) return;
          this.addCatalogs({ [locale]: res } as Catalogs);
        };

        if (isThenable(result)) {
          this.pendingBoundaries.add(boundaryId);
          activePromises.push(
            (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
              processResult(res);
              this.pendingBoundaries.delete(boundaryId);
            }),
          );
        } else {
          processResult(result);
        }
      } catch (err) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          console.error(
            `[Zintl] Failed to load catalog for boundary "${boundaryId}" (${locale})`,
            err,
          );
        }
      }
    }

    if (activePromises.length > 0) {
      await Promise.all(activePromises);
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(`[Zintl] Locale "${locale}" hydrated.`);
      }
      this.notify();
    } else {
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(`[Zintl] Locale "${locale}" hydrated.`);
      }
      this.notify();
    }
  }

  registerLoader(boundaryId: string, loader: Loader) {
    globalRegistry.set(boundaryId, loader);
    const result = loader(this.locale);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      this.addCatalogs({ [this.locale]: res } as Catalogs);
    };

    if (isThenable(result)) {
      this.pendingBoundaries.add(boundaryId);
      return (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
        processResult(res);
        this.pendingBoundaries.delete(boundaryId);
      });
    } else {
      processResult(result);
    }
  }

  loadLazyBoundary(boundaryId: string, loader: Loader) {
    if (this.catalogs[this.locale]?.[boundaryId]) return;
    if (this.pendingBoundaries.has(boundaryId)) return;

    this.pendingBoundaries.add(boundaryId);

    try {
      const result = loader(this.locale);
      const processResult = (res: any) => {
        this.pendingBoundaries.delete(boundaryId);
        if (!res) return;
        this.addCatalogs({ [this.locale]: res } as Catalogs);
      };

      if (isThenable(result)) {
        const p = (result as Promise<any>)
          .then((res) => {
            processResult(res);
          })
          .catch(() => {
            this.pendingBoundaries.delete(boundaryId);
          });
        this.pendingPromises.push(p);
        return p;
      } else {
        processResult(result);
      }
    } catch {
      this.pendingBoundaries.delete(boundaryId);
    }
  }
}

export let globalRegistry: Map<string, Loader>;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_registry) {
    (globalThis as any).__zintl_registry = new Map<string, Loader>();
  }
  globalRegistry = (globalThis as any).__zintl_registry;
} else {
  globalRegistry = new Map<string, Loader>();
}

export let defaultInstance: I18nStore;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_default_instance) {
    (globalThis as any).__zintl_default_instance = new I18nStore();
  }
  defaultInstance = (globalThis as any).__zintl_default_instance;
} else {
  defaultInstance = new I18nStore();
}

let currentInstance = defaultInstance;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_current_instance) {
    (globalThis as any).__zintl_current_instance = defaultInstance;
  }
  currentInstance = (globalThis as any).__zintl_current_instance;
}

export function getActiveInstance() {
  if (storeStorage) {
    const store = storeStorage.getStore();
    if (store) return store;
  }
  if (
    typeof window === "undefined" &&
    typeof globalThis !== "undefined" &&
    (globalThis as any).__zintl_active
  ) {
    return (globalThis as any).__zintl_active;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_current_instance) {
    return (globalThis as any).__zintl_current_instance;
  }
  if (typeof window !== "undefined") {
    const inst = currentInstance;
    const locales = inst.getLocales();
    const docLang =
      typeof document !== "undefined" && document.documentElement
        ? document.documentElement.lang
        : "";

    let targetLocale = "";
    const pathname = window.location ? window.location.pathname : "";
    if (pathname && locales.length > 0) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        targetLocale = parts[0];
      }
    }

    if (!targetLocale && docLang && locales.includes(docLang)) {
      targetLocale = docLang;
    }

    if (targetLocale && targetLocale !== inst.locale) {
      void inst.setLocale(targetLocale);
    }
  }
  return currentInstance;
}

export function setActiveInstance(instance: I18nStore) {
  currentInstance = instance;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__zintl_current_instance = instance;
  }
}

export function registerLoader(boundaryId: string, loader: Loader) {
  globalRegistry.set(boundaryId, loader);

  const instance = getActiveInstance();
  if (instance.catalogs[instance.locale]?.[boundaryId]) {
    return;
  }
  try {
    const result = loader(instance.locale);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      instance.addCatalogs({ [instance.locale]: res } as Catalogs);
    };

    if (isThenable(result)) {
      const p = (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
        processResult(res);
      });
      if ((instance as any).pendingPromises) {
        (instance as any).pendingPromises.push(p);
      }
      return p;
    } else {
      processResult(result);
    }
  } catch (err) {
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      console.error(`[Zintl] Failed to load initial catalog for boundary "${boundaryId}"`, err);
    }
  }
}

export function unregisterLoader(boundaryId: string) {
  globalRegistry.delete(boundaryId);
}

export function setLocale(locale?: string | null) {
  return getActiveInstance().setLocale(locale);
}

export function getLocale() {
  return getActiveInstance().locale;
}

export function subscribe(listener: () => void) {
  return getActiveInstance().subscribe(listener);
}

export function addCatalogs(catalogs: Catalogs) {
  return getActiveInstance().addCatalogs(catalogs);
}

export function getStoreVersion() {
  return getActiveInstance().version;
}

export function isThenable(obj: any): obj is Promise<any> {
  return obj && typeof obj.then === "function";
}
