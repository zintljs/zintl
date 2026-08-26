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
  /**
   * Catalogs can be deleted and corrupted underneath a running app, and it
   * survives (`chaos-catalog`).
   */
  | "chaos"
  /**
   * A boundary file can be **renamed** underneath a running app: the update
   * still propagates, and the old catalogs are reclaimed (`chaos-boundary`).
   *
   * Split from `chaos` because they are two guarantees, and measuring the second
   * host is what showed it. All six Rsbuild projects satisfy `chaos` — the
   * capability had been unclaimable there for a *contract* reason (L-062), and
   * once that was fixed the catalog half simply passed. Not one of them
   * satisfies this, and none of them fails for a host reason: a graph node for
   * the deleted file survives a deletion the compiler was told about and acted
   * on (L-076).
   *
   * One capability covering both would have to be refused on all six, recording
   * a defect Zintl has on *every* host as something Rsbuild cannot do — the
   * mistake L-049, L-056 and L-062 each made in a different place.
   */
  | "chaos-boundary"
  | "memory"
  | "performance"
  | "transform"
  | "build"
  | "graph"
  | "assets"
  /**
   * Editing a localized static asset updates the page (ZHMR §5).
   *
   * Separate from `assets`, which is a build-time claim: the asset contract
   * proves the compiler *substituted* the right file for the active boundary,
   * and this one proves the `b_assets` virtual boundary cascades to every
   * entry's manager when that file changes. The two hosts reach it by different
   * routes — Vite fans out through `entryFilePaths`, Rspack relies on the asset
   * being a genuine `?zintl-raw` import — so neither implies the other.
   */
  | "asset-hmr"
  /**
   * The project imports a targeted asset **plainly**, so it is delivered by URL.
   *
   * A structural claim about the project, not a claim that Zintl gets it right —
   * the contract that measures it is currently `pending` for a Zintl reason, and
   * the distinction is the one `chaos-boundary` records: a capability says what a
   * project can be asked, and a pending contract says what the answer is.
   *
   * The other half of `assets`, which only ever measured the `?raw` case — the
   * import asking for an asset's *contents*. A plain import asks for a URL
   * instead, and that path did not exist before proposal 035: binary assets were
   * excluded from catalogs and resolved by nothing, so a targeted `.pdf` was
   * copied to disk and read by no one.
   *
   * Claim it with `referenceAsset` declared.
   */
  | "asset-reference"
  /**
   * An artifact with no bytes fails the **build**.
   *
   * `assets` proves a filled artifact reaches the browser; this proves an
   * unfilled one never gets that far. The two are opposite halves of the same
   * guarantee and neither implies the other — before 035 the first held while
   * the second silently shipped the source locale's bytes.
   *
   * Needs a project that can build and an `assetFile` to empty. The contract
   * restores what it emptied, so claiming it costs one extra build.
   */
  | "asset-integrity"
  /**
   * The project can declare source edits that *grow* the graph (ZHMR §4.1③, §4.2).
   *
   * Adding a sink is the warm path and adding an anchor or a `$L` colony is the
   * hard one, and both need a per-project answer for where and what to insert —
   * framework syntax differs. Claim it only with `addSink` and `addAnchor`
   * declared, the same relationship `chaos` has with `renameBoundary`.
   */
  | "hmr-structural"
  /**
   * An edit to a server-only boundary reaches the browser (ZHMR §4.3).
   *
   * Distinct from `hmr`, which is about the client graph. A module the browser
   * never imported cannot be hot-replaced there at all, so the guarantee is a
   * different one — the server broadcasts a full reload — and it is provable
   * only on a project with a string that renders *only* on the server. Claim it
   * with `serverOnlyEdit` declared.
   */
  | "hmr-server-refresh"
  /**
   * A source string edit is **hot-replaced in place**, not answered by a reload.
   *
   * `hmr` says the edit reaches the browser. This says *how*, and the two are
   * genuinely different guarantees — a reload delivers the same text while
   * discarding application state, so `hmr` alone is satisfied by both.
   *
   * The line is real and was measured, not assumed. It runs through the
   * framework rather than the host: every Vite project hot-replaces, and on
   * Rspack the React and Vue projects do while the vanilla and Svelte ones
   * reload, which is exactly the `hasClientReactivity` gate L-030 describes —
   * a vanilla entry's only repaint is re-running itself, so it declines the
   * update and lets it bubble (L-035). That is correct behaviour, not a defect,
   * and until now it lived only in manifest prose.
   *
   * Gate anything that observes *frames* on this. A contract watching for a
   * blank intermediate render has nothing to watch when the document is
   * replaced wholesale.
   */
  | "hmr-warm"
  | "multiplex-fenced";

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
  /**
   * Recognise a network request that fetched a locale catalog.
   *
   * Defaults to Vite's virtual-module URL, which carries the locale in the path.
   * That default is a **host convention, not a Zintl one**: an Rspack build
   * emits catalogs as ordinary hashed async chunks, so nothing in the URL names
   * a locale and a project on that host has to say what one of its own catalog
   * requests looks like.
   *
   * The contract's question — "did switching locale fetch a catalog rather than
   * read one already inlined" — is host-neutral. Only the spelling of the answer
   * is not, which is exactly the kind of per-project quirk an adapter exists to
   * hold.
   *
   * Declared as a property with an explicit `this: void` rather than a method:
   * contracts read it off the adapter and fall back to a default, so it travels
   * as a bare function and never as a receiver-bound call.
   */
  isCatalogRequest?: (this: void, url: string, locale: string) => boolean;
}

/**
 * A source edit a contract makes, described by the project rather than guessed.
 *
 * `anchorOn` is text that must already be present in `file`; `insert` goes in
 * immediately after it. Anchoring on existing content rather than on a line
 * number keeps the declaration honest when the example is edited — a stale
 * `anchorOn` fails loudly instead of inserting into the wrong place.
 */
export interface SourceInsertion {
  /** The file to edit, relative to the project root. */
  file: string;
  /** Existing text in `file` that `insert` is placed after. */
  anchorOn: string;
  /** What to insert. */
  insert: string;
  /** Text the insertion is expected to make visible, if it renders. */
  expectText?: string;
  /**
   * Where `expectText` appears, when it is not the project's usual heading.
   *
   * A new sink is normally a new element, so conflating it with
   * `headingSelector` is the same mistake `AssetsAdapter` had to undo.
   */
  selector?: string;
}

export interface HmrAdapter extends BaseAdapter {
  /**
   * Where this project keeps a string that is rendered **only on the server**.
   *
   * ZHMR §4.3: a browser cannot hot-update a module that is not in its own
   * graph, so an edit to a server-only boundary has to arrive as a full reload
   * instead. Proving that needs a boundary which really is server-only — an
   * edit to a shared component takes the ordinary warm path and would pass the
   * contract for the wrong reason.
   *
   * Omit it and the project cannot claim the server-refresh capability, which
   * is the honest relationship; `ChaosAdapter.renameBoundary` is the precedent.
   */
  serverOnlyEdit?: { file: string; find: string; replaceWith: string };

  /**
   * Add a translatable string without changing the boundary hierarchy.
   *
   * ZHMR §4.1③ calls this the warm path: a new sink is new content in an
   * existing boundary, so it must hot-replace rather than reload.
   */
  /**
   * An edit to the heading file that changes the file and **no translatable
   * string** — the host's own hot-update round trip, with nothing for Zintl to
   * reconcile.
   *
   * `performance-hmr` prices this immediately before the real edit and compares
   * the two, so a busy machine inflates both and cancels out. It has to be
   * declared rather than synthesised: appending trailing whitespace works on a
   * module and is *nothing at all* to an SFC, where content outside the blocks
   * never reaches the compiler and no update is pushed. Where a no-op may
   * legally go is a property of the dialect, which is the same reason
   * `addSink` and `addAnchor` are declared here (ledger L-069, L-074).
   *
   * A comment just inside the file's script region is the usual answer.
   */
  perfNoopEdit?: SourceInsertion;
  addSink?: SourceInsertion;

  /**
   * Add a `zintl()` anchor or a dynamic import that opens a new colony.
   *
   * ZHMR §4.2 calls this the structural path: the graph's shape changed, so a
   * full reload is the *correct* outcome rather than a failure to hot-replace.
   */
  addAnchor?: SourceInsertion;
}

/**
 * How to rename one of this project's boundary files.
 *
 * `chaos-boundary` renames the file holding the heading and rewrites the import
 * that names it, then checks that hot updates still work against the new path —
 * which is a question about content-based boundary identity, and host-neutral.
 * *Which* file, and what the importer calls it, are not.
 *
 * This used to be a `switch (exampleName)` inside the contract, throwing
 * `Unsupported example for boundary rename` for anything not listed. A contract
 * that names apps is exactly what the contract layer forbids (CLAUDE.md,
 * "Testing architecture"), and the cost was concrete: a project could not claim
 * `chaos` without editing the contract, so the capability was recorded as
 * host-limited when it was really contract-limited.
 */
export interface ChaosAdapter extends BaseAdapter {
  /**
   * Omit it and the project cannot claim `chaos` — which is the honest
   * relationship, rather than a contract that throws when it meets a stranger.
   */
  renameBoundary?: {
    /** The file holding the heading, relative to the project root. */
    fromPath: string;
    /** Where it moves to. */
    toPath: string;
    /** The file importing it, whose source the rename rewrites. */
    parentPath: string;
    /** The specifier in `parentPath`, before and after. */
    importSearch: string;
    importReplace: string;
  };
}

/**
 * A project that renders a localized static asset.
 *
 * The asset contract used to import its expected strings straight from the
 * `assets-basic` fixture and assert them against `headingSelector` — so it
 * described one project rather than a capability, and any second claimant would
 * have failed on text belonging to the first. Contracts never name an app
 * (CLAUDE.md, "Testing architecture"); the per-project answers live here.
 *
 * Separate from `headingSelector` on purpose: an app's heading and its asset are
 * usually different elements, and conflating them is what made the contract
 * unclaimable elsewhere.
 */
export interface AssetsAdapter extends BaseAdapter {
  /** The CSS selector holding the localized asset's text */
  assetSelector: string;
  /** Expected asset text per locale, keyed by locale code */
  assetText: Record<string, string>;
  /**
   * The **source** asset file, relative to the project root.
   *
   * Only the source path is declared. Where its localized siblings live is not
   * a project fact but a compiler one — `outputDir` plus the default
   * `<path>.<locale><ext>` pattern — so `localizedAssetPath()` derives it
   * rather than asking every manifest to repeat a convention it does not own.
   *
   * Omit it and the project cannot claim `asset-hmr`.
   */
  assetFile?: string;
  /**
   * A targeted asset imported **plainly**, and so delivered as a URL.
   *
   * Declared separately from `assetFile` because it is a different claim about
   * a different asset: that one is imported with `?raw` and arrives as text,
   * this one arrives as a link to bytes. A project can have either, both, or
   * neither.
   *
   * `bytes` is the **authored** content per locale, base64-encoded — what the
   * URL must actually serve. Comparing bytes rather than URLs is deliberate: a
   * per-locale URL that resolves to the source file looks right in the DOM and
   * is the exact defect this exists to catch.
   *
   * Omit it and the project cannot claim `asset-reference`.
   */
  referenceAsset?: {
    /** Element whose `src` holds the resolved URL. */
    selector: string;
    /** The source asset, relative to the project root. */
    file: string;
    /** Base64 of the bytes each locale must serve, keyed by locale code. */
    bytes: Record<string, string>;
  };
  /**
   * Show the app in `locale` from a cold load.
   *
   * A fresh navigation rather than a runtime switch, deliberately: this contract
   * is about the build substituting the right asset for the active boundary, not
   * about switching locale afterwards.
   */
  navigateLocale(lab: Lab, locale: string): Promise<void>;
}

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
  adapter: BaseAdapter &
    Partial<LocaleSwitchAdapter & HmrAdapter & SsrAdapter & AssetsAdapter & ChaosAdapter>;

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
   * `"rsbuild"` is a supported configuration, not the falsification target it
   * began as — it drives build, dev server and hot updates, and the projects on
   * it claim browser capabilities like any other. What it does not claim is
   * `ssr` or `multiplex-fenced`'s opposite: per-locale HTML fan-out and SSR are
   * Vite-only and deliberately so.
   *
   * A capability here is a claim about the **full suite**, not about a contract
   * run alone. `memory` on `rsbuild-react-basic` passes ten isolated runs in ten and
   * fails three in three under four-worker contention; `node scripts/flake.js
   * all` is what settles it (ledger L-050).
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
