import type { Lab } from "../environment/lab.js";

export type Capability =
  | "spa"
  | "ssr"
  | "hmr"
  | "locale-switch"
  | "rtl"
  | "boundary-graph"
  | "hmr-stress"
  | "locale-switch-stress"
  | "chaos"
  | "memory"
  | "performance";

export interface BaseAdapter {
  /** Navigate to the app's initial state with source locale */
  navigateHome(lab: Lab): Promise<void>;
  /** The CSS selector that contains the main visible heading text */
  headingSelector: string;
  /** The expected initial heading text in the source locale */
  initialHeadingText: string;
  /** The file (relative to example root) that contains the heading string */
  headingFile: string;
}

export interface LocaleSwitchAdapter extends BaseAdapter {
  /** Programmatically switch to a target locale */
  switchLocale(lab: Lab, locale: string): Promise<void>;
}

export interface HmrAdapter extends BaseAdapter {}

export interface SsrAdapter extends BaseAdapter {
  /** The URL path that serves the SSR'd page in a given locale */
  ssrPath(locale: string): string;
}

export interface ExampleManifest {
  /** Example directory name in examples/ */
  name: string;
  /** Capabilities this example claims */
  capabilities: Capability[];
  /** The adapter for this example */
  adapter: BaseAdapter & Partial<LocaleSwitchAdapter & HmrAdapter & SsrAdapter>;
}

export interface Contract<TAdapter = BaseAdapter> {
  /** Human-readable name for test reporting */
  readonly name: string;
  /** What this contract proves */
  readonly description: string;
  /** The capabilities this contract requires */
  readonly requires: ReadonlyArray<Capability>;
  /** The invariant steps */
  execute(lab: Lab, adapter: TAdapter): Promise<void>;
}
