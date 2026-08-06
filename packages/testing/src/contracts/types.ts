import type { Lab } from "../environment/lab.js";
import type { ZintlPluginOptions, BuildTarget, DriverKind } from "../environment/driver.js";
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

  /**
   * Which build tool this project is driven through. Defaults to Vite.
   *
   * A manifest choosing `"rsbuild"` is a proposal 026 falsification target, not
   * a supported configuration — see `docs/spec/proposals/026-leak-ledger.md`.
   * Such a manifest should claim only build-time capabilities, since the dev
   * server and hot-update paths are Vite-only.
   */
  driver?: DriverKind;
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
  /**
   * Why this contract does not yet assert what its name claims.
   *
   * Set it and the contract is *skipped*, with the reason in the report. A
   * contract whose body has been commented out still runs, still passes, and
   * still reports its capability as covered — which is the worst state a test
   * can be in: it occupies the slot where the real coverage would go and tells
   * everyone the slot is filled.
   *
   * A string, not a boolean, for the same reason as `strictDeliveryExempt`: a
   * gap without a stated cause is one nobody can pick up.
   */
  readonly pending?: string;
  /**
   * Why this contract does not yet hold **for particular projects**, keyed by
   * manifest name.
   *
   * A blocker is rarely uniform. `chaos-boundary` passes on three frameworks
   * and fails on one, and skipping all four to describe that throws away the
   * three that work — which is the same loss as marking the whole contract
   * green would be, in the other direction. Per-project keeps the coverage that
   * exists and names only the gap that does not.
   */
  readonly pendingFor?: Record<string, string>;
  /** The invariant steps — manifest is the third arg for build/compile contracts */
  execute(lab: Lab, adapter: TAdapter, manifest: ProjectManifest): Promise<void>;
}
