/**
 * Facet self-activation: which facets apply to this project, and why.
 *
 * This replaces a table in `autoFacets` that mapped detected frameworks to
 * facets and encoded the exceptions as `if` statements — most tellingly
 * `if (!isNext)`, whose reason ("Next.js brings its own SSR facets; adding the
 * generic ones would collide on `wrapCode` at the same priority") lived in a
 * comment rather than in anything the system could act on.
 *
 * Under the inversion each facet declares its own condition, and core stops
 * knowing the names of frameworks. Two things make that safe rather than merely
 * distributed, both from proposal 026 §10:
 *
 * - **Activation is not a boolean.** Real conditions involve supersession — a
 *   Next facet subsuming the generic SSR one. Independent predicates cannot
 *   express "I replace you", so `supersedes` is a first-class declaration and
 *   `conflicts` is the hard-error case.
 * - **There must be an explain path.** Distributed activation without one is
 *   worse than the central switch it replaces, so every decision here produces
 *   a trace entry — including the negative ones, which are the entries someone
 *   debugging "why is React support off?" actually needs.
 *
 * Order is deliberately *not* load-bearing. Membership is decided here;
 * precedence is decided by `priority` in `resolveFacets`. Neither depends on
 * the order facets were registered in, which is the property §10 asks for.
 */
import type { FacetActivationContext, FacetWhen, ZintlFacet } from "@zintljs/compiler";

/** Why a facet ended up on or off. */
export interface FacetTraceEntry {
  name: string;
  active: boolean;
  /** Human-readable reason, e.g. `when.framework=react ✓` or `superseded by nextjs-ssr-wrapping`. */
  reason: string;
}

export interface ActivationResult {
  facets: ZintlFacet[];
  trace: FacetTraceEntry[];
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Evaluate a `when` descriptor, returning the reason rather than just a verdict.
 *
 * Every present field must hold; an absent field is not a constraint. The
 * returned string is what the trace shows, so it names the field that decided
 * and the value that failed it.
 */
function evaluateWhen(
  when: FacetWhen | undefined,
  ctx: FacetActivationContext,
): {
  ok: boolean;
  reason: string;
} {
  if (!when) return { ok: true, reason: "unconditional" };

  const reasons: string[] = [];

  const frameworks = asArray(when.framework);
  if (frameworks.length > 0) {
    const hit = frameworks.find((f) => ctx.frameworks.includes(f));
    if (!hit) {
      return {
        ok: false,
        reason: `when.framework=${frameworks.join("|")} ✗ (detected: ${ctx.frameworks.join(", ") || "none"})`,
      };
    }
    reasons.push(`framework=${hit}`);
  }

  const bundlers = asArray(when.bundler);
  if (bundlers.length > 0) {
    const hit = bundlers.find((b) => b === ctx.bundler);
    if (!hit) {
      return {
        ok: false,
        reason: `when.bundler=${bundlers.join("|")} ✗ (host: ${ctx.bundler})`,
      };
    }
    reasons.push(`bundler=${hit}`);
  }

  const dependencies = asArray(when.dependency);
  if (dependencies.length > 0) {
    const hit = dependencies.find((d) => ctx.dependencies[d] !== undefined);
    if (!hit) {
      return { ok: false, reason: `when.dependency=${dependencies.join("|")} ✗ (not installed)` };
    }
    reasons.push(`dependency=${hit}`);
  }

  if (when.ssr !== undefined) {
    if (when.ssr !== ctx.isSsr) {
      return { ok: false, reason: `when.ssr=${when.ssr} ✗ (project: ${ctx.isSsr})` };
    }
    reasons.push(`ssr=${when.ssr}`);
  }

  if (when.dev !== undefined) {
    if (when.dev !== ctx.isDev) {
      return { ok: false, reason: `when.dev=${when.dev} ✗ (project: ${ctx.isDev})` };
    }
    reasons.push(`dev=${when.dev}`);
  }

  return { ok: true, reason: reasons.length > 0 ? `${reasons.join(", ")} ✓` : "unconditional" };
}

/** Does `target` name this facet, either directly or through something it provides? */
function matches(facet: ZintlFacet, target: string): boolean {
  return facet.name === target || (facet.provides ?? []).includes(target);
}

/**
 * Decide which facets apply, and record why for every candidate.
 *
 * Three passes, in this order and for a reason: a facet cannot supersede one
 * that was never going to activate, and a conflict between two facets only
 * matters once both have survived supersession.
 */
export function activateFacets(
  candidates: ZintlFacet[],
  ctx: FacetActivationContext,
): ActivationResult {
  const trace: FacetTraceEntry[] = [];

  // 1. Conditions.
  const passed: ZintlFacet[] = [];
  for (const facet of candidates) {
    const verdict = evaluateWhen(facet.when, ctx);
    if (verdict.ok && facet.activate && !facet.activate(ctx)) {
      trace.push({ name: facet.name, active: false, reason: "activate() ✗" });
      continue;
    }
    if (!verdict.ok) {
      trace.push({ name: facet.name, active: false, reason: verdict.reason });
      continue;
    }
    passed.push(facet);
  }

  // 2. Supersession. Evaluated against the facets that passed their own
  //    condition, so a superseding facet that is itself inactive displaces
  //    nothing.
  const supersededBy = new Map<string, string>();
  for (const facet of passed) {
    for (const target of facet.supersedes ?? []) {
      for (const other of passed) {
        if (other !== facet && matches(other, target)) {
          supersededBy.set(other.name, facet.name);
        }
      }
    }
  }

  const surviving = passed.filter((f) => !supersededBy.has(f.name));
  for (const facet of passed) {
    const winner = supersededBy.get(facet.name);
    trace.push(
      winner
        ? { name: facet.name, active: false, reason: `superseded by ${winner}` }
        : { name: facet.name, active: true, reason: evaluateWhen(facet.when, ctx).reason },
    );
  }

  // 3. Conflicts — a hard error, because the alternative is a silent winner in
  //    a pair that declared there is no sensible winner.
  for (const facet of surviving) {
    for (const target of facet.conflicts ?? []) {
      const clash = surviving.find((o) => o !== facet && matches(o, target));
      if (clash) {
        throw new Error(
          `[Zintl] Facet conflict: "${facet.name}" declares it cannot coexist with "${clash.name}"` +
            `${clash.name === target ? "" : ` (via "${target}")`}. ` +
            `Remove one, or have one supersede the other.`,
        );
      }
    }
  }

  return { facets: surviving, trace };
}

/** Render a trace as readable lines — for `--debug`, and for the golden files. */
export function formatFacetTrace(trace: FacetTraceEntry[]): string {
  return trace.map((e) => `${e.active ? "✓" : "✗"} ${e.name.padEnd(28)} ${e.reason}`).join("\n");
}
