declare const process: any;

type Catalog = Record<string, string | Function>;
type BoundaryCatalogs = Record<string, Catalog>;
export type Catalogs = Record<string, BoundaryCatalogs>;
type LoaderResult = Catalog | BoundaryCatalogs | Promise<Catalog | BoundaryCatalogs>;
export type Loader = (locale: string) => LoaderResult;

let storeStorage: any = null;
if (typeof window === "undefined" && typeof process !== "undefined") {
  try {
    const asyncHooks = await import("node:async_hooks");
    if (asyncHooks && asyncHooks.AsyncLocalStorage) {
      storeStorage = new asyncHooks.AsyncLocalStorage();
    }
  } catch {}
}

export class I18nStore {
  locale: string = "";
  catalogs: Catalogs = {};
  debug: boolean = (typeof process !== "undefined" && process.env.ZINTL_DEBUG === "true") || false;
  pendingBoundaries = new Set<string>();
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
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(`[Zintl] Locale "${locale}" hydrated.`);
      }
      this.notify();
    } else {
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
}

const globalRegistry = new Map<string, Loader>();
let defaultInstance = new I18nStore();
let currentInstance = defaultInstance;

export function getActiveInstance() {
  if (storeStorage) {
    const store = storeStorage.getStore();
    if (store) return store;
  }
  return currentInstance;
}

export function setActiveInstance(instance: I18nStore) {
  currentInstance = instance;
}

export function runInRequestScope<T>(
  urlOrReq: any,
  locales: string[],
  defaultLocale: string,
  callback: () => T,
): T {
  if (typeof window === "undefined" && storeStorage) {
    let locale = defaultLocale;
    if (urlOrReq) {
      let pathname = "";
      if (typeof urlOrReq === "string") {
        pathname = urlOrReq;
      } else if (typeof urlOrReq === "object") {
        pathname = urlOrReq.url || urlOrReq.path || "";
      }

      pathname = pathname.split("?")[0].split("#")[0];
      if (pathname.includes("://")) {
        try {
          pathname = new URL(pathname).pathname;
        } catch {
          pathname = pathname.replace(/^https?:\/\/[^/]+/, "");
        }
      } else {
        pathname = pathname.replace(/^[^/]+:\d+/, "");
        pathname = pathname.replace(/^[^/]+\.[^/]+/, "");
      }

      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        locale = parts[0];
      }
    }

    const store = new I18nStore();
    store.locale = locale;
    return storeStorage.run(store, () => {
      // Auto-hydrate the registered loaders for this new store context
      for (const [, loader] of globalRegistry.entries()) {
        try {
          const result = loader(locale);
          const processResult = (res: any) => {
            if (!res) return;
            store.addCatalogs({ [locale]: res } as Catalogs);
          };
          if (isThenable(result)) {
            void (result as Promise<any>).then(processResult);
          } else {
            processResult(result);
          }
        } catch {}
      }
      return callback();
    });
  }
  return callback();
}

export { storeStorage };

export function registerLoader(boundaryId: string, loader: Loader) {
  globalRegistry.set(boundaryId, loader);

  // Sync current active instance with this loader
  const instance = getActiveInstance();
  try {
    const result = loader(instance.locale);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      instance.addCatalogs({ [instance.locale]: res } as Catalogs);
    };

    if (isThenable(result)) {
      return (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
        processResult(res);
      });
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

// export function getCatalogs() {
//   return getActiveInstance().catalogs;
// }

export function subscribe(listener: () => void) {
  return getActiveInstance().subscribe(listener);
}

export function addCatalogs(catalogs: Catalogs) {
  return getActiveInstance().addCatalogs(catalogs);
}

function isThenable(obj: any): obj is Promise<any> {
  return obj && typeof obj.then === "function";
}
