import type Context from "../context.js";
import type { HostUpdateApplier } from "./applier.js";

/**
 * Only the registration fence lives here.
 *
 * The types and the plan builder are deliberately *not* re-exported: every
 * consumer of them is inside `hmr/` or a hook that imports the specific module,
 * so a barrel would only add a second name for each and let the two drift.
 */

/**
 * Attach a host's update applier, having first asked its facet whether it claims
 * one.
 *
 * The combination this exists to refuse is an applier wired up for a bundler
 * whose facet declares no `hotUpdate`. That is the worst available failure mode:
 * invalidations get computed and applied, so the host does real work on every
 * keystroke, while `hmrSelfAcceptCode` returns nothing so no module ever accepts
 * them. Everything looks busy and nothing changes on screen.
 *
 * **Declines rather than throws**, unlike the L-022 multiplex fence it otherwise
 * mirrors. The difference is who the audience is. L-022 fences a *user's*
 * configuration — `multiplex: true` on a host that cannot do it — and the only
 * useful response is to stop and say so. This one can only be reached by a
 * mistake inside Zintl, where the correct behaviour is already well-defined:
 * a host with no declared hot-update story gets no applier, which is what "no
 * hot updates on this host" has always meant. Throwing would convert a
 * repository-internal error into a crash in someone else's dev server.
 *
 * The opposite direction — a facet declaring `hotUpdate` that no host honours,
 * which is precisely the state Rsbuild was in before proposal 029 — is caught by
 * a unit test and the composition guardrail, not here: there is no moment at
 * runtime when "nobody has registered one *yet*" can be told from "nobody ever
 * will".
 *
 * Registers unconditionally when no capabilities have been resolved at all. That
 * is a compiler assembled outside `resolveFacets` — a test double, in practice —
 * and it has declared nothing to contradict.
 */
export function registerUpdateApplier(ctx: Context, applier: HostUpdateApplier): boolean {
  const flags = ctx.compiler?._resolved?.flags;
  if (flags && !flags.hotUpdate) {
    ctx.compiler._logger
      .withPrefix("HMR")
      .warn(
        `Declining the "${applier.name}" update applier: this bundler's facet declares no ` +
          `\`hotUpdate\` support, so Zintl emits no acceptance code for it and applying ` +
          `invalidations would be work no module can consume. See docs/spec/ZDB.md §7a.`,
      );
    return false;
  }
  ctx.updateApplier = applier;
  return true;
}
