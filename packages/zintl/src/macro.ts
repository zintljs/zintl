/**
 * @module @zintl/vite/macro
 *
 * This is the Macro Facade.
 * The functions here are primarily for developers to use as code markers (macros).
 * The compiler transforms these calls into the Internal Runtime Engine equivalents.
 */

/**
 * Trust Anchor Macro.
 *
 * Mark the current site as an internationalization boundary.
 * The compiler transforms this into a 'loadI18nInstance' call with automated hydration.
 *
 * @zintl-macro
 */
export async function zintl(_locale?: string): Promise<any> {
  // LOGIC-FREE: This is a marker for the compiler.
  // In a non-transformed environment, this is a no-op.
  return Promise.resolve();
}

/**
 * Explicit Translation Macro.
 *
 * Mark a string literal for extraction and translation.
 * The compiler transforms this into a '_t' call with injected context.
 *
 * @zintl-macro
 */
export function t(key: string, _params: Record<string, any> = {}): string {
  // LOGIC-FREE: This is a marker for the compiler.
  // In a non-transformed environment, it returns the key as-is.
  return key;
}

// Re-export core types and functions for DX
export function getLocale(): string {
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_active) {
    return (globalThis as any).__zintl_active.locale;
  }
  return "";
}

export function setLocale(_locale?: string | null): Promise<any> {
  return Promise.resolve();
}

export function subscribe(_listener: () => void): () => void {
  return () => {};
}

export function getStoreVersion(): number {
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_active) {
    return (globalThis as any).__zintl_active.version;
  }
  return 0;
}

export type Catalogs = Record<string, Record<string, Record<string, string | Function>>>;
export type Loader = (locale: string) => any;
export interface I18nInstanceConfig {
  locale?: string;
  catalogs?: Catalogs;
  loaders?: Record<string, Loader>;
  debug?: boolean;
}
