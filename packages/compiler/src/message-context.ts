/**
 * Everything the compiler knows about one string, gathered for a human.
 *
 * ## Why this exists
 *
 * A catalog is `{ "Open": "" }`. Next to the code that is exactly right — the
 * source text is the key and the call site is a click away. Handed to a
 * translator with no repo, no screen and no build, it is close to worthless:
 * they cannot tell whether *Open* is a verb or an adjective, and missing context
 * is the single most expensive recurring cost in localization.
 *
 * Every TMS answers this with a hand-written `context` field that is stale the
 * day after someone types it. Zintl does not have to type it. The boundary graph
 * already knows which screens a string reaches, how many boundaries share it,
 * and what expression produced `{input}` — and because all of that is
 * **derived**, it cannot go stale. That is the actual claim of proposal 032 §3:
 * not "Zintl exports to Crowdin", but that Zintl can tell translators things
 * their TMS has never been able to tell them.
 *
 * ## Why it is a module rather than a method
 *
 * Same shape as {@link ./reconcile.ts}: plain functions over explicit inputs,
 * no manager, no compiler. A caller assembles the world; this reads it. That
 * makes every claim below testable against a hand-built graph, which matters
 * because the interesting cases — a string shared across four boundaries, an
 * entry that reaches one boundary and not another — are tedious to produce from
 * real source and trivial to state directly.
 *
 * ## Everything here is best-effort, deliberately
 *
 * A field that cannot be derived is `undefined`, never a throw and never a
 * guess. This is enrichment: a translator reading "appears on Checkout" is
 * better off than one reading nothing, and both are better off than one reading
 * a screen name that is wrong. The graphs are also genuinely absent early in a
 * dev session, and a context API that throws before the first flush would be
 * unusable exactly where it is most wanted.
 */

import type { Manifest } from "./reconcile.js";
import type { SourceLocation } from "./types/ast.js";
import type { BoundaryGraph, ChunkGraph, MetadataGraph } from "./types/graph.js";
import type { ObservedSink, TagMapEntry } from "./types/observation.js";

/**
 * One place a string appears, in one boundary.
 *
 * Per sink and **not unioned across them**, matching how the manifest itself
 * keys — one string reached from an `alt` and a `title` is one message with two
 * occurrences. That is information rather than duplication: a translator writing
 * one string for both wants to know it is doing two jobs. A consumer that wants
 * the union can take it; this will not take it for them.
 */
export interface MessageOccurrence {
  /** Where it sits, for a human: `alt`, `button`, `h1`. */
  context?: string;
  /** The `@zintl-note` directive — a translator note, already authored. */
  note?: string;
  location: SourceLocation;
  /**
   * What produced each placeholder.
   *
   * `{input}` alone is unanswerable — a translator cannot tell whether it will
   * be a name, a count or a date. `user.firstName` is not.
   */
  variables?: { name: string; expression: string }[];
  /** `@zintl-pass` context variables, for target-language asymmetry. */
  passVars?: Record<string, string>;
  /** Which alias corresponds to which real tag, for a stitched sentence. */
  tagMap?: TagMapEntry[];
  /** Whether this text is part of a larger stitched host. */
  isFragment?: boolean;
}

/** Everything derivable about one string in one boundary. */
export interface MessageContext {
  text: string;
  boundaryId: string;
  occurrences: MessageOccurrence[];
  /**
   * Every **other** boundary carrying this exact text.
   *
   * The fact a translator is never told and most needs: editing this
   * translation changes all of them. It is the difference between a safe edit
   * and a regression, and no TMS can compute it because no TMS knows what a
   * boundary is.
   */
  sharedWith: string[];
  /**
   * The entry points that reach this boundary — "this appears on Checkout".
   *
   * Empty rather than absent when the graph is known and nothing reaches the
   * boundary, which is itself worth reporting: a string on no screen is a string
   * that ships for nothing.
   */
  screens: string[];
  /** The chunk this boundary lands in, and how it loads. */
  chunk?: { id: string; type: "entry" | "lazy" | "shared" };
}

/** The state {@link deriveMessageContext} reads. Assembled by the caller. */
export interface MessageContextWorld {
  manifest: Manifest;
  metadataGraph: MetadataGraph;
  boundaryGraph: BoundaryGraph | null;
  chunkGraph: ChunkGraph | null;
  /**
   * Boundaries statically reachable from one entry.
   *
   * Injected rather than walked here, so this module reuses
   * `GraphManager.getStaticDependencyTree` — which already memoises and already
   * handles the cases a fresh DFS would get subtly wrong — instead of growing a
   * second traversal that can disagree with the first.
   */
  reachableFrom?: (entryId: string) => Set<string>;
}

/** A boundary id maps to the file that owns it by dropping the function scope. */
function fileOf(boundaryId: string): string {
  return boundaryId.split(":")[0];
}

/**
 * The sink that produced one manifest entry, matched by position.
 *
 * By `location.start` rather than by text, because matching on text is exactly
 * the case that needs disambiguating: two `Open`s in one boundary are two sinks
 * with two contexts, and pairing them by text would attach the first sink's
 * variables to both. An entry with no surviving sink — a manual `t()` call, or a
 * boundary whose metadata has been evicted — simply has less to report.
 */
function sinkFor(
  boundaryId: string,
  location: SourceLocation,
  world: MessageContextWorld,
): ObservedSink | undefined {
  const sinks = world.metadataGraph[fileOf(boundaryId)]?.sinks;
  if (!sinks) return undefined;
  return sinks.find((s) => s.boundaryId === boundaryId && s.location.start === location.start);
}

/**
 * Everything known about `key` as it appears in `boundaryId`.
 *
 * Returns `null` when the boundary does not carry that string at all, which is a
 * question rather than a failure — an exporter iterating a stale key list should
 * get an answer it can skip, not an exception.
 *
 * **Cost.** `sharedWith` scans the whole manifest, so calling this once per
 * message over a large project is quadratic. That is fine for the diagnostic and
 * single-lookup uses it has today, and a bulk variant belongs with the first
 * consumer that actually iterates (032 §7 step 3) rather than being written
 * ahead of one — an exported entry point with no caller is how a hook rots into
 * being both dead and wrong.
 */
export function deriveMessageContext(
  boundaryId: string,
  key: string,
  world: MessageContextWorld,
): MessageContext | null {
  const entries = (world.manifest[boundaryId] || []).filter((e) => e.text === key);
  if (entries.length === 0) return null;

  const occurrences: MessageOccurrence[] = entries.map((entry) => {
    const sink = sinkFor(boundaryId, entry.location, world);
    const variables = sink?.variables
      ?.filter((v) => v.expression)
      .map((v) => ({ name: v.name, expression: v.expression }));

    return {
      context: entry.context,
      note: entry.note,
      location: entry.location,
      variables: variables?.length ? variables : undefined,
      passVars: sink?.passVars,
      tagMap: sink?.tagMap,
      isFragment: sink?.isFragment,
    };
  });

  const sharedWith: string[] = [];
  for (const [bId, bEntries] of Object.entries(world.manifest)) {
    if (bId === boundaryId) continue;
    if (bEntries.some((e) => e.text === key)) sharedWith.push(bId);
  }
  sharedWith.sort();

  const screens: string[] = [];
  if (world.boundaryGraph && world.reachableFrom) {
    for (const entryId of world.boundaryGraph.entries) {
      if (world.reachableFrom(entryId).has(boundaryId)) screens.push(entryId);
    }
    screens.sort();
  }

  const ownerId = world.chunkGraph?.boundaryToOwner.get(boundaryId);
  const owner = ownerId ? world.chunkGraph?.chunks.get(ownerId) : undefined;

  return {
    text: key,
    boundaryId,
    occurrences,
    sharedWith,
    screens,
    chunk: owner ? { id: owner.id, type: owner.type } : undefined,
  };
}
