/**
 * Facet assembly — gathering the candidate facets, then letting them decide.
 *
 * This file used to *choose*: it mapped detected frameworks to facets and wrote
 * the exceptions as conditionals, most tellingly `if (!isNext)`, whose reason
 * lived in a comment. Under the self-activation inversion it only *gathers* —
 * every built-in facet is offered as a candidate and each one answers for
 * itself, via `activateFacets`.
 *
 * What that buys is not tidiness. Adding a framework used to mean editing this
 * file; now it means shipping a facet that knows its own condition, which is the
 * difference between a plugin system and a table.
 *
 * The one thing core still knows is how to *detect* frameworks, because
 * somebody has to read `package.json`. It reports what it found and does not
 * decide what that implies.
 */
import {
  ASSETS_FACET_NAME,
  assetsFacet,
  clientSpaFacet,
  htmlFacet,
  litFacet,
  nextjsFacet,
  preactFacet,
  reactFacet,
  rspackFacet,
  solidFacet,
  ssrFacet,
  svelteFacet,
  vanillaFacet,
  viteFacet,
  vueFacet,
} from "@zintljs/compiler/facets";
import type { AssetTargetConfig, FacetActivationContext, ZintlFacet } from "@zintljs/compiler";
import type { FacetsInput } from "../types.js";
import { activateFacets, type ActivationResult } from "./activate.js";

/**
 * The sentinel meaning "include the built-in facets".
 *
 * It replaced `"auto"`, which was misleading: it read as "be automatic", and
 * automatic is not optional any more — every facet self-activates, and one with
 * no condition is unconditional with no check performed. What the sentinel
 * actually selects is *which set of facets is on the table*, so it is spelled
 * for that. `"auto"` was removed rather than aliased; Zintl is pre-1.0 and a
 * silent second spelling is a migration nobody ever finishes.
 */
export const BUILTINS = "builtins";

/** Marker produced by {@link excludeFacet}, recognised during flattening. */
interface FacetExclusion {
  readonly __zintlExclude: string;
}

function isExclusion(value: unknown): value is FacetExclusion {
  return typeof value === "object" && value !== null && "__zintlExclude" in value;
}

/**
 * Drop one built-in facet by name.
 *
 * The gap this fills: `"builtins"` is all-or-nothing, so a project that wants
 * everything except one facet previously had to list every facet by hand and
 * keep that list in sync forever. Superseding is the right tool when you are
 * *replacing* a facet; this is for simply not wanting one.
 *
 * @example
 * ```ts
 * zintl({ facets: ["builtins", excludeFacet("client-spa")] })
 * ```
 */
export function excludeFacet(name: string): FacetsInput {
  return { __zintlExclude: name } as unknown as FacetsInput;
}

export interface AssembleInput {
  /** Frameworks detected for this project. */
  frameworks: string[];
  /**
   * Which build tool is hosting the plugin. Required, and deliberately without
   * a default — a plausible-looking default for a host-supplied value is how
   * ledger L-008 and L-011 both happened.
   */
  bundler: string;
  /** Whether this build targets SSR. */
  ssr?: boolean;
  isDev?: boolean;
  root?: string;
  pluginNames?: string[];
  dependencies?: Record<string, string>;
  /** User-declared facets; defaults to `[BUILTINS]`. */
  facets?: FacetsInput[];
  /** Asset facet configuration drawn from plugin options. */
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
  /** Extra extraction targets from the plugin's `additionalTargets` option. */
  additionalTargets?: string[];
}

/**
 * Every built-in facet, offered unconditionally.
 *
 * Note what is *not* here any more: no framework switch, no `isNext` guard, no
 * `if (ssr)`. Each of those became a declaration on the facet that owned the
 * decision.
 */
export function builtinFacets(input: AssembleInput): ZintlFacet[] {
  const { assetsTarget, virtualAssets } = input;
  return [
    reactFacet(),
    preactFacet(),
    solidFacet(),
    vueFacet(),
    svelteFacet(),
    litFacet(),
    nextjsFacet(),
    ssrFacet(),
    clientSpaFacet(),
    vanillaFacet(),
    htmlFacet(),
    // The plugin option is `assetsTarget` (it names the subsystem); the facet
    // option is `targets` (the facet is already about assets). This line is the
    // one and only place the two are bridged.
    assetsFacet({ targets: assetsTarget, virtualAssets }),
  ].flat(Infinity) as ZintlFacet[];
}

/**
 * Bundler facets, which are candidates regardless of what the user listed.
 *
 * The old code appended `viteFacet()` unconditionally and said the plugin
 * "cannot function without it". That was half right: the hooks matter, but they
 * are *infrastructure*, not a user choice — so opting out of the built-in set
 * should not silently strip the host integration too.
 *
 * What changes under self-activation is that being a candidate is no longer the
 * same as being active. Each declares the host it serves, so exactly one of them
 * applies — where before every project was handed the Vite facet no matter who
 * was building.
 */
function bundlerFacets(): ZintlFacet[] {
  return [viteFacet(), rspackFacet()];
}

/**
 * Flatten user facet input, expanding the builtins sentinel, thunks and arrays.
 *
 * Exclusions are collected rather than returned: they are instructions about
 * the list, not members of it. So are overrides — see below.
 *
 * ## Naming a built-in facet replaces it
 *
 * `facets: ["builtins", assetsFacet({ targets: ["mdx"] })]` is the obvious way
 * to reconfigure one built-in, and it used to be a coin flip. Both facets are
 * called `assets`, both sit at priority 0, and `resolveFacets` dedupes by name
 * with a stable sort — so whichever the caller happened to list first won, and
 * the other was discarded in silence. Listing `"builtins"` first, which is what
 * the docs show, discarded the user's.
 *
 * That is a direct violation of the invariant `activate.ts` states in its
 * header: *order is deliberately not load-bearing*. Membership belongs here,
 * precedence belongs to `priority`, and neither is supposed to care what order
 * facets were registered in.
 *
 * So provenance is tracked, and a facet the user named by hand replaces the
 * built-in of the same name wherever either appears in the list. The names it
 * replaced come back in `overridden` so the activation trace can say so —
 * silence was the actual defect here, not the choice of winner.
 *
 * `alwaysCandidates` (the bundler facets) are treated as built-ins for this
 * purpose: a project shipping its own `vite` facet means to replace ours.
 */
export function flattenFacets(
  inputs: FacetsInput[],
  builtins: ZintlFacet[],
  alwaysCandidates: ZintlFacet[] = [],
): { facets: ZintlFacet[]; excluded: Set<string>; overridden: Set<string> } {
  const facets: ZintlFacet[] = [];
  /** Parallel to `facets`: did this entry come from us rather than the user? */
  const isOurs: boolean[] = [];
  const excluded = new Set<string>();

  function processInput(input: unknown, ours: boolean): void {
    if (!input) return;
    if (input === BUILTINS) {
      for (const f of builtins) processInput(f, true);
      return;
    }
    if (typeof input === "function") {
      processInput((input as () => unknown)(), ours);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) processInput(item, ours);
      return;
    }
    if (isExclusion(input)) {
      excluded.add(input.__zintlExclude);
      return;
    }
    if (typeof input === "object") {
      facets.push(input as ZintlFacet);
      isOurs.push(ours);
      return;
    }
  }

  for (const input of inputs) processInput(input, false);
  for (const facet of alwaysCandidates) processInput(facet, true);

  const userNames = new Set(facets.filter((_, i) => !isOurs[i]).map((f) => f.name));
  const overridden = new Set<string>();

  // Filtered in place rather than re-grouped: dropping entries preserves the
  // relative order of everything that survives, where partitioning would not.
  const kept = facets.filter((facet, i) => {
    if (!isOurs[i] || !userNames.has(facet.name)) return true;
    overridden.add(facet.name);
    return false;
  });

  return { facets: kept, excluded, overridden };
}

function toContext(input: AssembleInput): FacetActivationContext {
  return {
    root: input.root ?? process.cwd(),
    bundler: input.bundler,
    isDev: input.isDev ?? false,
    isSsr: input.ssr ?? false,
    frameworks: input.frameworks,
    pluginNames: input.pluginNames ?? [],
    dependencies: input.dependencies ?? {},
  };
}

/**
 * The active facet list for a project, with the trace explaining every decision.
 */
/**
 * The plugin's `additionalTargets`, as a facet.
 *
 * Carried this way rather than merged into the compiled state afterwards,
 * because array capabilities already union across facets — so a synthetic
 * contributor gets additive behaviour for free, appears in the activation trace
 * like everything else, and needs no second code path that could disagree with
 * the first.
 *
 * Its own name, never a built-in's: naming it `vanilla-extraction` would
 * *replace* that facet under the provenance rule rather than add to it, which
 * is the precise opposite of the option's purpose.
 */
function additionalTargetsFacet(targets: string[] | undefined): ZintlFacet[] {
  if (!targets || targets.length === 0) return [];
  return [
    {
      name: "additional-targets",
      concern: "extraction",
      targets,
    } as unknown as ZintlFacet,
  ];
}

/**
 * Plugin options that configure a *built-in* facet, paired with the facet each
 * one reaches.
 *
 * `virtualAssets` counts only when `true`. It is resolved against a default
 * before it arrives here, so "not set" and "set to false" are indistinguishable
 * — and `false` is the facet's own default anyway, so a project that lost it
 * lost nothing. `assetsTarget` has no default and is passed through raw, so
 * `undefined` really does mean nobody asked.
 */
function optionsConfiguringBuiltins(input: AssembleInput): { option: string; facet: string }[] {
  const configured: { option: string; facet: string }[] = [];
  if (input.assetsTarget !== undefined) {
    configured.push({ option: "assetsTarget", facet: ASSETS_FACET_NAME });
  }
  if (input.virtualAssets === true) {
    configured.push({ option: "virtualAssets", facet: ASSETS_FACET_NAME });
  }
  return configured;
}

/**
 * Refuse a build where a plugin option configures a facet that is not in it.
 *
 * `assetsTarget` and `virtualAssets` configure the **built-in** assets facet, and
 * `builtinFacets()` is the single place that bridge is made. Replace that facet
 * with your own, or exclude it, and the options are still accepted, still
 * validated, and configure nothing — the assets they name are simply not
 * localized, and nothing says so. Proposal 034 §1.6 and §8.
 *
 * A hard error rather than a warning, and rather than picking a winner. There is
 * no sensible winner to pick: the option cannot be forwarded into a facet the
 * project constructed itself, so honouring both is not on the table. What is on
 * the table is saying so, and the consequence of not saying so is wrong output
 * rather than a surprising configuration — assets quietly shipping in one
 * language, which a line in a build log is a poor defence against.
 *
 * Both spellings survive. This is 034 §8's option 3: the harm was never that two
 * spellings exist, it was that one of them could be discarded in silence.
 */
function assertOptionsReachTheirFacet(
  input: AssembleInput,
  overridden: Set<string>,
  excluded: Set<string>,
): void {
  const stranded = optionsConfiguringBuiltins(input).filter(
    ({ facet }) => overridden.has(facet) || excluded.has(facet),
  );
  if (stranded.length === 0) return;

  const options = stranded.map(({ option }) => `\`${option}\``);
  const facet = stranded[0].facet;
  const replaced = overridden.has(facet);
  const spelled =
    options.length === 1 ? options[0] : `${options.slice(0, -1).join(", ")} and ${options.at(-1)}`;

  throw new Error(
    [
      `[Zintl] ${spelled} configure${options.length === 1 ? "s" : ""} the built-in ` +
        `"${facet}" facet, which this project ${replaced ? "replaced with its own" : "excluded"}.`,
      ``,
      `The option would have been accepted and then ignored, so the files it names`,
      `would not be localized and nothing would have said so.`,
      ``,
      replaced
        ? `Fix:    pass them to your own facet instead — assetsFacet({ targets: [...] }).`
        : `Fix:    stop excluding "${facet}", or drop the option.`,
      `Or:     remove ${spelled} from the plugin options.`,
    ].join("\n"),
  );
}

export function assembleFacetsWithTrace(input: AssembleInput): ActivationResult {
  const { facets, excluded, overridden } = flattenFacets(
    [...(input.facets ?? [BUILTINS]), ...additionalTargetsFacet(input.additionalTargets)],
    builtinFacets(input),
    bundlerFacets(),
  );
  assertOptionsReachTheirFacet(input, overridden, excluded);

  const candidates = facets.filter((f) => !excluded.has(f.name));
  const result = activateFacets(candidates, toContext(input));

  for (const name of excluded) {
    result.trace.push({ name, active: false, reason: "excluded by configuration" });
  }

  for (const name of overridden) {
    result.trace.push({
      name: `${name} (built-in)`,
      active: false,
      reason: `replaced by the "${name}" facet you passed`,
    });
  }

  return result;
}

/** The active facet list for a project. */
export function assembleFacets(input: AssembleInput): ZintlFacet[] {
  return assembleFacetsWithTrace(input).facets;
}
