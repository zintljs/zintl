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

---

## Phase 1 — direction, and two defects on the supported path

§2.3(b) asked for a home for per-locale direction, and warned that the runtime "should not grow a
hardcoded list of RTL languages".

**The warning was aimed at a problem that does not exist.** Direction is not knowledge Zintl has to
invent — it is **authored data**, written into every HTML catalog unconditionally by
`HtmlManager.syncHtmlProjections` and edited by whoever edits translations. The only hardcoded RTL
list in the compiler sits on the baked-literal path, already inside a facet, and does not move. So
the item was a **hoist**, not an invention: the projection already derived `rtlLocales[]` from those
catalogs, and the work was to make that one derivation serve two consumers instead of one.

`ContentFacet.rtlLocales` is that seam, unioned by `ZintlCompiler.getRtlLocales()` and substituted
into the runtime as `__ZINTL_RTL_LOCALES__`. Core never learns what direction means; it merges string
arrays.

### The two defects the hoist exposed

Both on the **Vite** path, both found by reading the generated bootstrap rather than by any failing
test, and together a complete explanation for the unexplained third layer of 026's L-019 —
_"adding the HTML catalog then destabilised it again"_:

**D1 — the projection's `apply()` guarded `dir` behind a check on `lang`.**

```js
function apply(locale) {
  if (document.documentElement.lang === locale) return; // ← removed
  document.documentElement.dir = rtl.includes(locale) ? "rtl" : "ltr";
  document.documentElement.lang = locale;
```

It reads as a cheap idempotence guard and is not one: `apply` owns **both** attributes, so anything
that set `lang` first — the store's own fallback, an SSR response, an earlier partial apply —
permanently locked `dir` out, with no path to correct it afterwards. Every statement in that function
is an idempotent assignment, so the guard bought nothing and cost the attribute it was standing in
front of.

**D2 — the store's fallback was an `else`, and the projection took the `if` without finishing the
job.** `publishLocale` called `__zintlApplyHtml` when installed and set `lang` itself otherwise. But
the projection installs `__zintlApplyHtml` **unconditionally** while emitting the `dir` line only
when the project has an RTL locale — so on every other project it claimed ownership of the document
and then declined to discharge it, silently suppressing the fallback that would have.

Fixed as an **ownership split** rather than two patches, because the `if`/`else` was the defect:

|                                      | Owns                                                                    |
| :----------------------------------- | :---------------------------------------------------------------------- |
| Projection bootstrap (parse time)    | initial `lang`/`dir`, title, description, deltas, preloads              |
| Store `publishLocale` (every switch) | `lang`, `dir` — then **delegates** to the projection, not instead of it |

`dir` is written only when `__ZINTL_RTL_LOCALES__` is non-empty. Empty means "this project never
spoke about direction", and asserting `"ltr"` there would start writing an attribute onto documents
that never had one.

### A bucket-3 delete, taken while in the neighbourhood

`getRuntimeCode` substituted `sourceLocale` with a regex matching a **TypeScript class-field
default** (`sourceLocale: string = "en"`). One `readonly`, one formatter rule or one compile-target
change from silently matching nothing — and a substitution that fails by doing nothing is the worst
shape available, since the runtime still loads and simply believes the wrong thing.

It was also **dead**: `store-core.ts:214` was the only occurrence of `sourceLocale` in the entire
runtime directory. Written, never read, and shipped in every production bundle. Deleted, along with
its regex, rather than adding a second fragile one beside it — `__ZINTL_RTL_LOCALES__` uses the
word-boundary sentinel mechanism `__ZINTL_DEV__` already proved.

---

### L-021 — Zintl links an HTML document to its boundary through a `<script src>` the Rsbuild template does not have

|                             |                                                               |
| :-------------------------- | :------------------------------------------------------------ |
| **Status**                  | **Open** — diagnosed, reproduced, deferred to §2.3(a)         |
| **Bucket**                  | **2 — relocate** (the link is host configuration, not markup) |
| **Facet contract changed?** | Not yet — the fix needs the HTML seam                         |

**What failed.** Nothing, loudly. With the direction mechanism landed and an HTML catalog authored
for the fixture, `dir` still did not follow the locale on Rsbuild — the substituted map came out
empty:

```js
if ([].length > 0) document.documentElement.dir = [].includes(locale) ? "rtl" : "ltr";
```

against `["ar"]` on every Vite example.

**The cause, probed rather than reasoned about.** Compiling the fixture directly and dumping the
graph:

```
htmlKeysInGraph:    ["index.html"]      ← observed
htmlWithProjection: ["index.html"]      ← projection payload extracted
scripts:            []                  ← nothing references an entry
leadsToBoundary:    { leads: false }    ← therefore unreachable
```

The document **is** discovered and extracted on this host. What is missing is the edge from it to any
trust anchor, because Zintl derives that edge from `<script src>` tags in the template — and an
Rsbuild template does not have one. Rsbuild injects the entry from `source.entry` at build time, so
its `index.html` is deliberately script-free, and that is the _conventional_ shape rather than a
quirk of this fixture.

**The assumption.** _"An HTML document names the scripts it loads."_ True of Vite, where the template
is a module-graph entry and the `<script type="module" src="/src/main.ts">` is both the real loader
and the link Zintl reads. On Rsbuild the same relationship exists but lives in `rsbuild.config.mjs`
as `source.entry` + `html.template`.

**Two things this corrects, and the second is a plan error worth naming.**

The 027 planning pass argued that §2.3(a) and §2.3(b) were independent, because `locale-switch`
asserts only `localeCoherent` and `dir` and never `<title>` — so direction alone should have
unblocked `rtl`. That reasoning was right about the _contract_ and wrong about the _data_: on Rsbuild
the direction map cannot be populated without knowing which entry a document belongs to, and that is
exactly the host knowledge §2.3(a)'s seam exists to supply. **027's original coupling of (a) and (b)
was correct**, for a reason neither document had written down.

Second, `htmlProjectionFacet` implements no `ContentFacet.discover`, which looked like the cause and
is not: `.html` is in the extraction facet's `extensions`, so `discover()` transforms it through the
extension branch before the content-facet branch is reached. A `discover` hook was written, measured
to be dead code, and removed. Recorded because "the obvious missing hook" was the first hypothesis
and cost a build to falsify.

**Deferred, not worked around.** The available shortcuts were to add a `<script>` tag the fixture
should not have — making the example unrepresentative of real Rsbuild apps, which is worse in
`examples/` than a stated gap — or to drop the reachability filter when reading direction, which
would read catalogs that `flush` never writes and never scaffolds on this host. Neither is a story
worth shipping.

**Consequence for the capability list.** `rtl` and `locale-switch` stay unclaimed on `rsbuild-spa`
until §2.3(a) lands. `<html lang>` remains correct there — the store has always been able to say what
locale it adopted — so the page stays coherent; it simply does not announce direction.

**Verified.** The mechanism itself works end to end on the supported path: every Vite example builds
with `["ar"]` inlined into the store, `locale-switch` and `locale-storm` pass on all four SPAs, and
`vpr verify` is green at 787 unit tests with the full contract suite at 118/118.
