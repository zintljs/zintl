# Proposal 027 — Leak Ledger

**Companion to** [027-completing-the-rsbuild-target.md](027-completing-the-rsbuild-target.md), and a
continuation of [026-leak-ledger.md](026-leak-ledger.md). Numbering continues from it — L-019 is the
last entry there, so this file starts at L-020.

Separate file because 026 is **COMPLETE** and its ledger is the artifact of a finished exercise.
Where work here falsifies something recorded there, the 026 entry gets a pointer rather than a
rewrite: an entry that was honestly written and later proved wrong is evidence about the method, and
editing it away destroys that evidence.

Same rules as 026: one entry per leak, recording **what failed**, **the assumption behind it**, **the
bucket** (§4.2 of 026 — **1 = facet it** · **2 = relocate it** · **3 = delete the guess**), **the fix
or the deferral**, and **whether the facet contract had to change**. Anything inferred rather than
reproduced is marked `INFERRED`.

---

## Phase 0 — verifying §2.3(c) before building anything

027 §2.3(c) asserted that the dev-only globals are absent on Rspack, cited that as the reason every
026 diagnosis was misleading, and made it the first work item: _"Do (c) first. It is the smallest, it
is a prerequisite for trusting any diagnosis."_

The planning pass disputed the premise — `__zintl_current_instance` is published at module scope and
is **not** `__ZINTL_DEV__`-gated ([store-core.ts:703-709](../../../packages/compiler/src/runtime/store-core.ts)),
and it appears six times in the committed `rsbuild-spa` production snapshot, identical to vanilla. So
before writing code, the item was reduced to a probe: claim `locale-switch`/`rtl` on the manifest
temporarily, run the contract, read what the page actually reports.

**The probe disagreed with both the proposal and the plan**, in different places:

| Global                             | 027 predicted | Plan predicted            | Measured                                      |
| :--------------------------------- | :------------ | :------------------------ | :-------------------------------------------- |
| `__zintl_current_instance`         | absent        | present                   | **present** (`storeLocale: "en"`)             |
| `__zintl_active`                   | —             | —                         | present                                       |
| settle beacon (`__zintl_version`)  | absent        | present (closed by L-018) | **absent**                                    |
| delivery ledger (`__zintl_ledger`) | absent        | present                   | **absent**                                    |
| `<html lang>`                      | —             | correct                   | correct (`"en"`, then `"ar"` after switching) |
| `<html dir>`                       | absent        | absent                    | absent — §2.3(b)'s job                        |

Two half-right predictions, and the disagreement is the useful part. The store **does** publish
itself; the beacon **is** missing; and the two facts have nothing to do with each other, which is
precisely why one claim covering both was wrong in both directions.

**This is why the probe was worth running before the fix.** Had §2.3(c) been implemented as written —
"publish the dev globals on a path that runs on Rspack" — it would have added a second publication of
a global that was already there, and left the actual defect untouched.

### Correction to 026's L-019

> _"Throughout, `__zintl_current_instance` was **absent** on this host — the store never publishes
> itself globally — which is why every diagnosis read `settle beacon: ABSENT` even on a page that was
> translating correctly. That is a third, separate gap."_

Both halves are wrong, and the causal link between them is the reason it looked coherent:

- `__zintl_current_instance` is **present**, and was at the time — module-scope publication predates
  026 (`2a07272`).
- The beacon was absent for an unrelated reason: `__ZINTL_DEV__` folded to `false`. See L-020.

The observation ("every diagnosis read `settle beacon: ABSENT`") was accurate. The explanation
attached to it was not, and it was `INFERRED` from the symptom rather than probed. A single
`page.evaluate` would have separated them at the time — which is the transferable lesson, not the
specific mistake.

---

### L-020 — Rsbuild leaves Rspack's `mode` at `"none"`, so L-018's dev detection never fires

|                             |                                                        |
| :-------------------------- | :----------------------------------------------------- |
| **Status**                  | **Fixed**                                              |
| **Bucket**                  | **2 — relocate** (ask the layer that knows)            |
| **Facet contract changed?** | No — but `BundlerHostView` gains a second supply route |

**What failed.** On the Rsbuild **dev server**, a page had no settle beacon and no delivery ledger,
so every harness diagnosis read `settle beacon: ABSENT — no Zintl runtime on the page` against a page
whose runtime was demonstrably present and working: it rendered, it translated, it switched locale,
and `__zintl_current_instance` reported the right one.

**The cause, measured rather than reasoned about.** Instrumenting `nativeHostView` and dumping the
Rspack compiler options under both actions:

|           | dev server                  | production build |
| :-------- | :-------------------------- | :--------------- |
| `mode`    | `"none"`                    | `"none"`         |
| `devtool` | `"cheap-module-source-map"` | `false`          |
| `watch`   | `false`                     | `false`          |

`mode` is **`"none"` in every action**. Rsbuild drives optimisation from its own configuration rather
than from webpack's mode presets, so it never sets the field L-018 taught Zintl to read. `isDev` was
therefore `false` on the dev server, `getRuntimeCode` folded `__ZINTL_DEV__` to `false`, and the
beacon and ledger — both of which begin `if (!__ZINTL_DEV__) return;` — compiled away.

**The assumption.** _"`compiler.options.mode` is this family's `command === "serve"`."_ True of
webpack and of raw Rspack, where the user sets it. Not true of a tool that _wraps_ Rspack and keeps
the dev/production distinction at its own layer.

**L-018 is not thereby wrong — it is incomplete, and it was verified against the wrong thing.** Its
ledger entry reports the fix as measurably effective ("the runtime store went from reporting
`undefined` to reporting `ar`"). That improvement was real, and it came from the same function's
`root` derivation, not from `isDev`. Two changes in one function, one piece of evidence, and it was
credited to the wrong half.

**The fix — ask the layer that knows.** Rsbuild's own plugin API answers this exactly:
`RsbuildContext.action` is `'dev' | 'build' | 'preview'`, documented as _"dev: will be set when
running `rsbuild dev` or `rsbuild.startDevServer()`"_. It is reachable through unplugin's `rsbuild`
escape hatch, whose `setup(api)` runs during Rsbuild's plugin initialisation — before any compilation
and therefore before `buildStart`, which is what makes it usable for a fact compiler construction
depends on.

So the plugin grows an `rsbuild: {}` block, structurally the twin of its `vite: {}` block, and
`Context.hostHints` carries the answer to `ensureCompiler`, which merges it over the native view.
`"preview"` is deliberately **not** dev — it serves a production build and should get the production
runtime it is previewing.

**Why a second supply route rather than a better `mode` test.** A host can be a **stack**. Rsbuild is
a configuration, dev-server and HTML layer on top of Rspack, and unplugin hands the plugin _Rspack's_
context under both. Some questions genuinely have no answer at the inner layer, and no amount of
squinting at `devtool` or `optimization.minimize` produces a principled one — those differ here only
because the test driver pins them for snapshot determinism, which is exactly the plausible-looking
signal Deliverable 2 §2.3 warns about. `hostHints` is a partial view by construction: it carries
facts the inner layer _could not_ supply, never overrides of ones it did.

**This is 027 §2.5's layering question arriving early, and answering itself.** §2.5 predicted that
the first genuine Rsbuild-level concern would be the HTML transform, and asked whether
`FacetActivationContext.bundler` needs to become a `hostChain`. The first one turned out to be
dev-detection instead — and it needs **no** facet change and no `hostChain`, because the concern
lives in the plugin's escape hatch rather than in a facet. Nothing ever asks
`bundler === "rsbuild"`. The block's _location in the file_ is the layering statement.

**Verified.** Same probe, after the fix: `__zintl_version: 4`, `__zintl_ledger: true`,
`__zintl_current_instance` still present. Full contract suite **118/118**, no snapshot churn — the
build-time contracts compile through `compileWithZintl` rather than through an Rsbuild instance, so
they never had a `hostHints` contribution and their output is unchanged.

**What this closes.** 027 §2.3(c) — dev diagnosis on this host is now trustworthy, which was the
stated prerequisite for everything after it. The remaining halves of L-019 are `dir` (§2.3(b)) and
the HTML seam (§2.3(a)).
