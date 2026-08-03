import type { Lab } from "../environment/lab.js";
import type { ZintlPluginOptions, BuildTarget } from "../environment/driver.js";
import type { ProjectSource } from "./source.js";

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
  | "performance"
  | "transform"
  | "build"
  | "graph"
  | "assets";

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

export interface ProjectManifest {
  /** Display name, used in test titles and snapshot paths */
  name: string;
  /**
   * Where this project comes from — an on-disk example today, an inline
   * fixture later. Nothing above this field knows the difference.
   */
  source: ProjectSource;
  /** Capabilities this project claims */
  capabilities: Capability[];
  /** The adapter for this project */
  adapter: BaseAdapter & Partial<LocaleSwitchAdapter & HmrAdapter & SsrAdapter>;

  /**
   * Zintl compiler options — single source of truth for tests.
   * Import ZintlPluginOptions from `zintl` in each manifest.
   */
  zintlOptions: ZintlPluginOptions;

  /**
   * Build targets for this project. Defaults to [{ name: "dist" }].
   * SSR projects declare both client and server targets.
   *
   * @example
   * buildTargets: [
   *   { name: "dist" },
   *   { name: "dist-server", overrides: { build: { ssr: "src/entry-server.tsx" } } },
   * ]
   */
  buildTargets?: BuildTarget[];
}

export interface Contract<TAdapter = BaseAdapter> {
  /** Human-readable name for test reporting */
  readonly name: string;
  /** What this contract proves */
  readonly description: string;
  /** The capabilities this contract requires */
  readonly requires: ReadonlyArray<Capability>;
  /**
   * Exempt this contract from strict delivery, with the reason.
   *
   * Some contracts deliberately break the application: a syntax error *should*
   * stall the runtime, and a deleted or corrupted catalog *should* fail to
   * apply. Under `ZINTL_STRICT_SETTLE` those are correct behaviour reported as
   * failures, so the exemption is declared here alongside `requires` rather
   * than inferred, passed by an environment variable, or decided per call site.
   *
   * A string, not a boolean, because an exemption without a reason is
   * indistinguishable from one nobody revisited.
   */
  readonly strictDeliveryExempt?: string;
  /** The invariant steps — manifest is the third arg for build/compile contracts */
  execute(lab: Lab, adapter: TAdapter, manifest: ProjectManifest): Promise<void>;
}
