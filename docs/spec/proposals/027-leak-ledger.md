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

---

## Phase 2 — the `assets` contract described a project, not a capability

§3.4 listed `assets` as _"already satisfiable — free coverage"_. It was not satisfiable at all.

`assets.contract.spec.ts` imported `assetsBasicText` **from the `assets-basic` fixture** and asserted
those strings against `adapter.headingSelector`. So the contract named an app, which
CLAUDE.md's testing architecture says a contract never does — and the cost was concrete rather than
stylistic: any second project claiming `assets` would have been asserted against the first project's
text, in whichever element happened to be its heading. On `rsbuild-spa` that is the `<h1>` reading
"Get started", against an expectation of "Hello World!".

It survived because it had exactly one claimant, so "the app's heading" and "the app's localized
asset" being the same element was true by coincidence. The generalisation moves the selector and the
expected text into an `AssetsAdapter`, where per-project answers belong, and keeps `assetSelector`
deliberately separate from `headingSelector` — on `rsbuild-spa` they are different elements, which is
the normal case and the one the old shape could not express.

**What it bought.** `assets` and `boundary-graph` are now claimed on `rsbuild-spa` and pass. The first
of those matters more than a count: L-009 — the defect where Rspack typed Zintl's generated
JavaScript by its `.txt` extension and base64'd it into a `data:` URI — had a **green build and green
contracts**, and was caught only by reading a snapshot. It is now asserted in a real browser against
rendered Arabic text.

### A measurement, recorded because §3.5 asks for it and it arrived early

Adding two contract cases changed the 4-worker failure rate enough to be worth writing down:

| Tree               | Runs | Failed | Which                                                 |
| :----------------- | :--- | :----- | :---------------------------------------------------- |
| baseline (stashed) | 4    | 0      | —                                                     |
| Phase 2            | 6    | 2      | `memory-leak`, then `hmr-hammer` — both `react-basic` |

**Stated with its confounds, because the honest reading is weaker than the table looks.** Both
failures landed in the first two runs, immediately after repeated full builds, and the following four
were green; the baseline runs happened after the machine had settled. Neither failure is in anything
this phase touched — both are the `react-basic` HMR family, i.e. the §2.4 ordering defect, and 026
recorded the same "a different contract fails on each high-load run" signature against an
**unmodified** tree at 2-in-3 before the fixture-race fix and 1-in-8 after.

So: elevated, plausibly by contention alone — two extra cases whose project is driven by a native
Rspack toolchain — and **not conclusive at this sample size**. The reason to record it rather than
move on is that §3.5 asks for exactly this measurement before promotion, and Phase 3 adds more load
again. Re-measure there with more runs, against this baseline, so a real regression stays
attributable instead of being absorbed into "that contract is flaky sometimes".

**Not claimed on `rsbuild-spa`, with reasons:** `locale-switch`/`rtl` (L-021), `performance`
(`performance-size` requires `locale-switch`, so it is blocked by L-021 rather than by anything about
performance), and `hmr` and everything downstream. Worth repeating one correction to §3.4's table:
`hmr-hammer` requires `["spa", "hmr-stress"]` and **not** `hmr`, so claiming `hmr-stress` alone would
have made it run and fail rather than skip.

---

## Phase 3 — promotion, and what the directory actually charged

`tests/fixtures/rsbuild-spa/` is now `examples/rsbuild-spa/`. `pnpm-workspace.yaml` globs
`examples/*`, so promotion is automatic on placement — which is precisely why the obligations had to
be met first rather than discovered by a red CI.

Three of §3.3's predictions were wrong, all in the cheap direction:

**A hand-written `env.d.ts` was not needed — and moving it broke a contract.** The fixture carried a
`declare module "*?raw"` shim, with a comment explaining that the Vite examples get this from
`types: ["vite/client"]` and that Rsbuild has no equivalent to inherit. It does:
`@rsbuild/core/types.d.ts` declares `*?raw` itself, along with `import.meta.env` and the asset
modules. So the shim is deleted and `tsconfig.json` says `types: ["@rsbuild/core/types"]`, exactly
mirroring how the Vite examples reach for `vite/client`.

Worth recording because of how it surfaced. The plan moved `env.d.ts` into `src/` to satisfy knip's
`project: ["src/**"]` glob — and that made it a **source file**, so `transform-dev` and
`transform-prod` immediately began snapshotting it. A deterministic three-for-three failure, caused
by the promotion housekeeping rather than by anything about Zintl. The right fix removed the file
instead of relocating it.

**Knip needed no configuration at all.** §3.3 predicted an `examples/rsbuild-spa` entry would be
required, since `@rsbuild/core` is imported only from a root-level `rsbuild.config.mjs` that falls
outside the `examples/**` project glob. Knip discovers it unaided. What the promotion _did_ require
was the opposite of a new exception: `ignore: ["tests/fixtures/rsbuild-spa/**"]` came out, and
`@rsbuild/core` came out of both the root `ignoreDependencies` **and** the root `package.json` — it
was a root devDependency only because the fixture was not a workspace member and resolved by walking
up. The app declares its own now.

**One snapshot moved, for a legible reason.** Renaming the package from `rsbuild-spa-fixture` to
`rsbuild-spa` changes the Rspack chunk global, `rspackChunkrsbuild_spa_fixture` →
`rspackChunkrsbuild_spa`. Six lines across five files, and nothing else in the build output changed.

### The composition guardrail was about to vouch for a fiction

`composition.test.ts` enumerates `examples/` from disk but passed `bundler: "vite"` in three places,
including the invariant _"every example resolves exactly one bundler facet"_, which asserted the
literal `["vite"]`.

That was true while `examples/` was Vite-only. After promotion it would have kept passing — by
describing an Rsbuild app as resolving `viteFacet`, and asserting that description was correct. A
guardrail vouching for a composition no build ever produces is worse than no guardrail, and the thing
it would have been vouching for is **exactly ledger L-012**: Vite syntax emitted into Rspack output.

The bundler is now derived per example from the config file on disk, and the invariant asserts _the
host's own facet_ rather than a constant. The golden file gained a `bundler:` line, and
`rsbuild-spa`'s entry reads as it should — `rspack [bundler]`, all three bundler hooks provided by
it, and the activation trace carrying `✗ vite  when.bundler=vite ✗ (host: rspack)`.

Its composition is otherwise **byte-identical to `vanilla-spa-basic`'s**, which is the property the
README claims and the reason the example is worth having: any difference in output is attributable to
the host rather than to the app.

### §3.5's measurement

| Tree                 | Runs | Failed | Which                                     |
| :------------------- | :--- | :----- | :---------------------------------------- |
| pre-Phase-2 baseline | 4    | 0      | —                                         |
| Phase 2              | 6    | 2      | `memory-leak`, `hmr-hammer` (react-basic) |
| Phase 3 (promoted)   | 6    | 1      | `hmr-hammer` (react-basic)                |

**The Phase 2 worry does not survive the extra data.** 1-in-6 sits inside the background rate 026
measured on an **unmodified** tree — 1-in-8 after the fixture-race fix — and every failure across all
three trees is the same `react-basic` HMR family, i.e. the §2.4 ordering defect, in nothing these
phases touched. The elevated Phase 2 reading is best explained by machine state: both of its failures
were the first two runs after repeated full builds, and the four after them were green.

**Wall clock: 77–84s across six runs**, against 92–106s measured before promotion. Promotion did not
lengthen the gate. Stated as "no material increase" rather than as a speed-up, because the comparison
spans different machine states and the suite is not an instrument for that.

Contract cases: **120**, up from 118 at the start of this proposal and 104 at the start of 026.

---

## Phase 4a — §2.3(a), the HTML seam, and L-021 closed

**L-021 — Status: Fixed.** Bucket **2 — relocate** (the link is host configuration, not markup).
Facet contract changed? **No** — and that is the finding.

§2.3(a) proposed a `BundlerFacet.transformHtml`, and §2.5 asked whether
`FacetActivationContext.bundler` must become a `hostChain` to support it. Neither was needed.
`ContentFacet.transformHtml` already exists and _is_ the projection; a bundler hook of the same name
beside it would have reproduced the `wrapCode`/`ssrWrapCode` two-vocabularies confusion the golden
files exposed in 026, one layer worse. And facets are data and string-returning functions —
`api.modifyHTML(fn)` must be _registered during plugin setup_, which only `packages/zintl` can do.

So the seam is a `hooks/html.ts` routed from the plugin's existing `rsbuild` block. **Which escape
hatch a hook sits in is the layering statement**: `rspackFacet` keeps the module-system concerns,
the `rsbuild` block keeps the HTML and dev-server ones, and nothing ever asks
`bundler === "rsbuild"`. §2.5's `hostChain` stays deferred, now with two Rsbuild-level concerns
built and neither needing it.

### The two things 026's attempt could not get past

**Identity.** `ModifyHTMLContext.filename` is an **output** name (`index.html`, relative to `dist`)
where Vite passes an absolute **source** path. 026 passed it straight through and got a blank page.
The inversion runs `filename` → `environment.htmlPaths` → entry name → `html.template` → source id,
and **bails loudly** when any step yields nothing, which is a real case: Rsbuild has a built-in
template, and a document Zintl cannot place is one whose translations would silently never appear.

**The boundary link — L-021 itself.** The same context carries `source.entry`, so the association
Rsbuild keeps in config instead of markup is available from the host that owns it. `CompilerOptions.
htmlEntries` is where it lands, unioned into a freshly observed document by `adoptHostHtmlEntries`.

Two details that would each have produced a half-working fix:

- It must update **both** `htmlProjection.scripts` _and_ `dependencies`. The extractor derives the
  second from the first _during_ extraction (`extractor/src/html.ts:225`), so afterwards they are
  two separate facts and both have to be told. Updating only the first gets the projection working
  while reachability — and therefore catalog scaffolding — stays broken.
- It must be registered on **`onBeforeEnvironmentCompile`, not `onBeforeBuild`**. Measured: the
  latter never fires for `rsbuild dev`. Both fire before `buildStart`, and the association has to
  exist before discovery or the document is analysed without it.

### What it bought

`index.html.translations.json` is now **scaffolded on this host**, `<html dir>` follows the locale,
`<title>` translates, and the projection bootstrap ships in the built page with `const rtl = ["ar"]`.
The runtime carries the same map, from the same derivation — Phase 1's mechanism was correct all
along and simply had no data to work with here.

`locale-switch`, `rtl` and `locale-switch-stress` are claimed and pass. Contract cases: **122**.

### A second contract that named a host rather than a capability

`locale-switch` asserted a request URL containing `virtual:zintl/content/ar/`. That is Vite's virtual
module spelling; Rspack emits catalogs as ordinary hashed async chunks. Same shape as the `assets`
contract in Phase 2 and generalised the same way — the question ("did switching fetch a catalog
rather than read one already inlined") is host-neutral, only the spelling is not, so an optional
`LocaleSwitchAdapter.isCatalogRequest` holds the answer and defaults to the Vite form.

Recorded honestly: this host's predicate cannot prove _which_ locale was fetched, because nothing in
the URL names one. It proves an async chunk was fetched during the switch, which for this app is a
catalog. Weaker than Vite's, and stated rather than hidden.

### `performance` deliberately not claimed

`performance-size` filters responses by the same Vite-shaped URLs and sees none of this host's
chunks. It was left unclaimed rather than taught a second spelling, because that contract's **own
header** documents it as measuring dev-wrapped modules inside a timing window and concedes it does
not measure what its name promises. Making a known-flawed contract portable is not the same as
earning a capability; it wants rewriting against built output first, for both hosts.

### One observation, recorded rather than diagnosed

`[Locale Switch] rsbuild-spa` failed once, in a full-suite run, with a signature unlike anything else
in this ledger:

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  body html length: 30        ← empty document
  settle beacon: ABSENT
```

The page navigated out from under the assertion. **Not reproduced since**: 4/4 green running the
locale contracts in isolation, and 4 further full-suite runs with no recurrence (the one failure in
those was `hmr-hammer` on `react-basic`, the §2.4 defect).

The standing suspicion, stated as a suspicion: the pooled Rsbuild dev server reloading the page while
a contract holds it. This phase made Zintl start **writing** an HTML catalog and its schema into the
watched source tree on this host, which it never did before — and unlike Vite, where
`handleHotUpdate` opens with `if (ctx.compiler.isWritingFile(file)) return;`, nothing here tells the
Rsbuild watcher that a compiler-authored write is not a user edit. That would make it load-sensitive
and rare, which matches.

Not chased further because the evidence is one occurrence, and `retry: 0` means the next one will be
recorded rather than swallowed. Named here so that if it returns, the first place to look is the
watcher rather than the assertion.

**A related fix that did land:** `index.html.translations.json` and its schema were generated but
**untracked**, so a fresh CI checkout would have built the example without them and regenerated them
mid-run. They are committed now, as every Vite example's equivalents already were.

---

### L-004 — `\0` recognition survived on a coincidence; now it goes through the facet

|                             |                                                          |
| :-------------------------- | :------------------------------------------------------- |
| **Status**                  | **Fixed**                                                |
| **Bucket**                  | **2 — relocate** (recognition belongs with construction) |
| **Facet contract changed?** | Yes — `BundlerFacet.isVirtualId`                         |

`BundlerFacet.resolveVirtualPath` existed to **construct** virtual ids. Nothing existed to
**recognise** them: core tested `id.startsWith("\0")` — Rollup's convention, hardcoded into a
bundler-agnostic layer — at seven sites deciding whether a module was Zintl's own.

On Rspack that test is false for virtual modules past the `transform` boundary, because unplugin
materialises them as real files under `<context>/node_modules/.virtual/` (verified against
`unplugin@3.3.0`'s `VIRTUAL_MODULE_PREFIX`, which also appends a pid segment unless Rspack's
`VirtualModulesPlugin` experiment is on). Nothing broke, because an adjacent
`id.includes("node_modules")` test happened to be true — **correct behaviour resting on another
project's choice of directory name.**

`isVirtualId` is the counterpart, with substring rather than prefix semantics because boundary ids
embed the module id they were minted from. `IOManager` is where it lands and is exposed from: every
other manager already holds an `IOManager` and none hold the system view, so one seam serves core,
`GraphManager` and `CatalogManager` alike. The no-facet default stays `id.includes("\0")`, so the
compiler's own unit tests keep the behaviour they had.

**Six of the seven sites converted; the seventh deliberately did not.** `isSsrEntryTarget` strips a
`\0` prefix so a user's SSR entry pattern can match, and already tries the unstripped id as well — it
is normalising, not asking about ownership, and routing it through the facet would have been
conversion for its own sake. Recorded because "seven sites" was the plan's number and six is the
honest one.

**The golden files could not see this hook, and could not see one that already existed.**
`composition.test.ts` lists the single-provider hooks it reports in two hand-maintained arrays, and
`hmrSelfAcceptCode` had been missing from both since it was added — so the artifact 026 §8 asked for,
whose whole purpose is making facet-surface changes visible, was blind to one. Both are listed now,
with a note at the arrays saying to add hooks there.

**Verified.** The composition diff is **160 insertions and zero deletions** — two new rows per entry,
`rspack` declaring both on the two `rsbuild-spa` variants and `vite` on the other 38, no winner
changed anywhere. **No contract snapshot moved at all**, on either host.

#### A diagnosis that was almost recorded as a defect

Mid-change, `[Serialized Graphs Snapshot] rsbuild-spa` began failing with a `b_assets` boundary
appearing from nowhere — a plausible story, since `isVirtualId` changes which ids are skipped when
building the boundary graph. Stashing the change and re-running showed **the baseline failing
identically**, so it was not the change at all.

The cause was `examples/rsbuild-spa/node_modules/.zintl`, which `copiedExampleSource` deliberately
copies as a warm starting state, holding compiler metadata accumulated across a dozen manual builds
run while debugging the HTML seam. Clearing it and rebuilding once — the order CI actually uses,
`build:examples` then `test:examples` — passes.

Worth recording twice over. It is 026's artifact-lifetime hazard arriving from a new direction: not a
stale artifact in the tracked tree, but one in a **gitignored** directory that the harness copies, so
a local run and a CI run can legitimately disagree. And it is the second time in this proposal that
`git stash` separated "my change broke it" from "it was already broken" — the same discipline L-013
was found by.

---

### L-022 — Under multiplex, claiming `.html` breaks the Rspack build outright

|                             |                                                                                    |
| :-------------------------- | :--------------------------------------------------------------------------------- |
| **Status**                  | **Fixed (fenced)** — see below. The real fan-out is still not designed for Rspack. |
| **Bucket**                  | **1 — declare it**, more precisely than L-006 managed                              |
| **Facet contract changed?** | Yes — `BundlerFacet.htmlFanOut`                                                    |

Found while building the L-005 reproduction, and it is **L-006 recurring in the exact branch L-006's
own note flagged as the risky one.**

L-006 fixed an unfiltered `load` hook that retyped every module on Rspack, by declaring
`loadIncludeHook`. Its entry ends with a warning worth quoting, because it turned out to be half the
story:

> _The filter has to be **exact, not generous**. `.html` is claimed only under multiplex, the sole
> mode where `loadHook` returns HTML. Claiming it unconditionally — the naturally cautious choice —
> reintroduces the bug for every non-multiplex app._

The narrowing is right, and the branch it narrows _to_ is itself destructive here:

```ts
if (cleanId.endsWith(".html")) return ctx.getMultiplex();
```

A multiplexed Rsbuild build therefore claims the HTML template, unplugin's `load` rule retypes it as
`javascript/auto`, and the build dies in the JS parser on `<!doctype html>` — inside
`html-rspack-plugin`'s child compilation, which is why the error names a loader chain rather than
Zintl.

**The assumption.** _"Under multiplex, Zintl serves the HTML, so claiming it is correct."_ True on
Vite, where multiplex HTML fan-out is implemented. On Rspack that path does not exist, so the claim
promises something the host cannot survive — and unlike a Rollup over-claim, which is free, here the
claim alone is the damage.

**Not fixed — fenced.** Multiplex/MPA fan-out is exactly what 026 §7 and 027 §6 exclude, and the real
fix still wants that path designed for Rspack rather than patched. But shipping a crash with someone
else's error message in front of it was never the right interim state, and 028 §5 named this the
first thing to do: turn the opaque `html-rspack-plugin` loader-chain crash into a clear, loud, early
Zintl error.

**The fence, not `if (bundler === …)`.** Following the pattern this ledger's own §4.2 exists to
enforce — ask the facet, don't test the bundler string — `BundlerFacet` gains `htmlFanOut?: boolean`.
`viteFacet` declares it `true`; `rspackFacet` declares nothing, deliberately, the same shape of
decision as its `hmrSelfAcceptCode` omission. It threads through `facets/resolve.ts` as a plain
OR-merged boolean (`MergeState`, `mergeFacet`'s `"bundler"` case, `stateToCapabilities`) — no
conflict semantics needed, unlike the priority-hook fields beside it — and lands in
`CapabilityFlags.htmlFanOut`.

The check itself sits in `host.ts::ensureCompiler`, between resolving capabilities and constructing
the compiler:

```ts
if (ctx.getMultiplex({ root: resolved.root }) && !capabilities.flags.htmlFanOut) {
  throw new Error(`[Zintl] Multiplex is not supported on "${resolved.bundler}": ...`);
}
```

That site was chosen, not assumed: `ensureCompiler` is idempotent and is the one chokepoint every
hook path funnels through (`buildStartHook` universally, `configResolvedHook` on Vite, defensively at
the top of `resolveIdHook`/`loadHook`), and `loadIncludeHook` — the hook that actually claims
`.html` — never calls `ensureCompiler` itself, so it only ever runs after `buildStartHook` has
already run and already thrown. Both `.html` branches in `hooks/resolve.ts` (`resolveIdHook` and
`loadIncludeHook`) keep no local guard, just a comment pointing here — a second check would only ever
run in the already-fenced case.

**Verified against a real build, not just a synthetic host view.** `tests/fixtures/multiplex-rsbuild-fence.ts`
is a real `zintljs/rsbuild` project with `multiplex: true`, driven through `RsbuildDriver` by
`tests/contracts/multiplex-fence.contract.spec.ts` (capability `"multiplex-fenced"`). The build now
rejects with the exact `[Zintl] Multiplex is not supported on "rspack": ...` message, thrown from
`ensureCompiler` inside a genuine Rspack `buildStart` hook — confirmed by temporarily asserting the
wrong message and watching the real one come back in the failure diff. `examples/rsbuild-spa` (no
`multiplex`) and `multiplex-assets` (Vite, multiplex, unaffected) both stay green.

What this does **not** do: L-005 is still blocked, because the _unfenced_ gap — no real HTML fan-out
on Rspack — is what blocks its reproduction, not the crash the fence removed.

---

### L-005 — still unreproduced, and now for a stated reason

|            |                                                                             |
| :--------- | :-------------------------------------------------------------------------- |
| **Status** | **Open** — blocked behind L-022's _unfenced_ gap, not the crash L-022 fixed |
| **Bucket** | Undecided, and the deciding evidence is still absent                        |

L-022 fencing the crash does not unblock this: the fence turns the build into a clean, early failure
for exactly the combination this reproduction needs, so reaching `emitFile` still requires the real
HTML fan-out to exist on Rspack, which remains undesigned.

The reproduction was attempted properly and produced three things worth more than another deferral.

**The control now exists.** `tests/fixtures/multiplex-assets.ts` is a multiplexed project with
`virtualAssets` and a localized asset, registered and passing on Vite, and it genuinely reaches
`emitFile` + `import.meta.ROLLUP_FILE_URL_*` — a path that had **no coverage at all** before. When
L-022 is fixed, adding the Rsbuild manifest beside it is a few lines.

**Two details decide whether that path is reached, and both were wrong on the first attempt.**

- **`?raw` never calls `emitFile`.** It returns a JavaScript string literal, which is precisely why
  every asset path exercised through 026 and this proposal survived on Rspack. Only a plain import
  asks the host for a URL.
- **The extension picks the strategy.** `.txt` and `.md` are content passthrough; _anything else_ is
  `binary-passthrough`, and that is the branch that emits. The first fixture used `.txt` and could
  not have reached `emitFile` on either host — it failed on Vite too, with the raw text arriving at
  the JS parser, which is a third thing now known: **a non-`?raw` text-asset import is unsupported on
  both hosts**, not an Rspack gap.

**What remains unknown is unchanged:** whether Rspack's reference-id-less `emitFile` wants a
`BundlerFacet.emitAsset` abstraction (bucket 1) or the compiler owning output naming so no handle is
needed (bucket 2). That decision still wants evidence, and the evidence still needs a build that
completes.

---

### The `locale-switch` observation, resolved — and it was the watcher

The Phase 4a entry above recorded a `[Locale Switch] rsbuild-spa` failure —
`Execution context was destroyed, most likely because of a navigation`, empty body — as an
unreproduced observation with a standing suspicion about compiler writes and the Rsbuild watcher.
**The suspicion was right about the mechanism and wrong about it being mysterious.**

It recurred, and diffing the worker copies against the example found the cause immediately:

```
.tmp/runs/w1/rsbuild-spa   Only in examples/…: index.html.translations.json, index.html.schema.json
.tmp/runs/w2/rsbuild-spa   (identical)
.tmp/runs/w3/rsbuild-spa   Only in examples/…: index.html.translations.json, index.html.schema.json
.tmp/runs/w4/rsbuild-spa   (identical)
```

`.tmp/runs` persists across runs and `prepareWorkerCopy` memoizes per worker, so w1 and w3 held
copies made **before** those catalogs existed. In a worker whose copy lacks the catalog, `flush`
writes it, the Rsbuild dev server sees a new file inside the watched tree, and the page reloads out
from under the assertion. Whichever worker drew the contract decided the outcome — which is exactly
the intermittency observed. Wiping `.tmp/runs`: **3 full-suite runs, 3 green.**

So not a product defect, and the second time in this proposal that a stale artifact under a
gitignored directory produced a convincing false finding — the first being `.zintl` in L-004. Both
are 026's artifact-lifetime hazard, and the practical lesson is narrow and worth stating: **when a
contract fails in a way that implicates the project's own files, diff the worker copy against the
origin before theorising.**

**One real behaviour it does expose.** On a project with no HTML catalog yet — a fresh checkout, or a
user adopting Zintl — the first Rsbuild dev run _does_ write one into the watched source tree and the
dev server _does_ reload once. Harmless and self-correcting, since `safeWriteFile` skips identical
content thereafter, but it is a first-run reload a user will see and it is not something Vite does:
`handleHotUpdate` there opens with `if (ctx.compiler.isWritingFile(file)) return;`, and nothing tells
the Rsbuild watcher that a compiler-authored write is not a user edit. Worth a `hostHints`-shaped
answer if Rsbuild ever becomes a supported target.

---

### L-023 — 027 §2.4's HMR ordering defect: instrumented, not reproduced; a different defect found instead

|                             |                                                             |
| :-------------------------- | :---------------------------------------------------------- |
| **Status**                  | **Open** — original hypothesis neither confirmed nor denied |
| **Bucket**                  | N/A — a diagnostic pass, not a fix                          |
| **Facet contract changed?** | No                                                          |

027 §2.4 named one unexamined candidate for `hmr-hammer`'s ~1-in-8 event loss on `react-basic`:
`hooks/hmr.ts`'s fallback scan, which matches modules to boundaries with loose `endsWith` comparisons
and, on a match, repoints `mod.file` and Vite's own `fileToModulesMap`. The hypothesis was that a
wrong repoint could make a later genuine edit to the real file hand the hook `modules: []`. 027's own
prescription: instrument first, reproduce, then decide — this entry is that pass.

**First attempt had an observer effect.** The natural, cheap instrumentation was `vLogger.debug(...)`
calls gated by the existing `DEBUG=zintl:<scope>` convention (`packages/extractor/src/logger.ts`).
Adding them and testing confirmed something worth recording on its own: **enabling exactly the scope
needed to see them — `DEBUG=zintl:vite` — suppresses `handleHotUpdateHook`'s invocation entirely**,
deterministically. Measured directly with an unconditional `console.error` probe: 32–40 invocations
per 4-project `hmr-hammer` run with `DEBUG` unset or set to an unrelated scope (`DEBUG=foo:bar`,
`DEBUG=1`), **zero** invocations across two repeated runs with `DEBUG=zintl:vite` specifically — and
the test still passed, meaning `hooks/transform.ts`'s independent invalidation path (its own comment:
"a second, independent invalidation path") was sufficient on its own. This predates this pass — the
one `vLogger.debug` call already in the function before any of this work would have had the same
effect — and it is real, reproducible, and entirely unexamined. Not chased further here; named so it
is not rediscovered from scratch, and because it makes `DEBUG`-gated console output categorically
unsafe as an observation channel for this specific hook.

**Routed around it with a silent, always-on ring buffer.** `Context.hmrTrace`
(`packages/zintl/src/context.ts`) — a fixed-capacity `Ring<HmrTraceEntry>` mirroring `DeliveryBus`'s
own `Ring` (`packages/compiler/src/bus/index.ts`, duplicated rather than imported since it isn't
exported past that package's public surface). Pushed to, never printed: hook entry (file, `seq`,
`modules.length`), both early-return guards, every `mod.file` reassignment (module id, old file, new
file, the driving `boundaryId`/`fileId`), and the return (`invalidatedCount` vs. `modules.length`,
passthrough or not). No `console.*` call exists in the new code, so it cannot reproduce the observer
effect above. Exposed to the test harness via `LabCompiler.hmrTrace`
(`packages/testing/src/environment/compiler.ts`), which reuses the exact `globalThis.
__zintl_active_contexts` bridge `LabCompiler.instance` already relied on — no new IPC — and surfaced
automatically in `describeStall()`'s failure diagnosis (`packages/testing/src/assertions/index.ts`),
alongside the wire-, runtime-, and compiler-ledger sections already there. Verified end-to-end with a
forced failure before trusting it on a real run: real trace data, no timing change, test still
converged correctly once the artificial assertion was reverted.

**Reproduction: ten full-suite runs at `maxWorkers: 4`** (`pnpm test:contracts`, the shape 026's own
notes document as necessary — an isolated `hmr-hammer` run does not reproduce this under contention).
`hmr-hammer` **did not fail once** in ten runs. Not conclusive at this sample size against a
documented ~1-in-8 rate (roughly 27% chance of seeing zero in ten independent tries), but it means
this pass produced no direct hit to interrogate.

**The repointing hypothesis: zero supporting evidence.** `grep -c "repoint"` across all ten run logs
is `0`, everywhere — the fallback scan's repointing block did not fire once, in any project, across
the whole suite, including a run that captured a same-family failure (below). `mg.getModulesByFile()`
— the exact-match lookup that runs before the fallback scan — was apparently always sufficient in
these ten runs. **This is evidence against, not proof against**: the hypothesis was written for
`hmr-hammer`'s specific symptom, and `hmr-hammer` itself never failed, so the hypothesis was never
actually placed where it could be falsified by its own target.

**What was found instead.** `[Memory Leak] react-basic` failed once (run 2 of 10), same HMR family
(repeated writes, convergence polling), with a distinct, evidenced signature:

- `hmr packets: {"update":20,"prune":3,"full-reload":3}` — three full-reloads inside an 18-iteration
  test.
- `settle beacon: 2` at iteration 17 of 18 — consistent with the beacon being reset by those reloads.
- Three console warnings: `ReactDOMClient.createRoot() on a container that has already been passed to
createRoot() before.`
- The hmr trace showing the hook firing **twice per write** for the same file (`modules=2`, then
  immediately `modules=0`).

This does not match §2.4's hypothesis. It matches a different, already-named, already-open item:
`docs/spec/proposals/024-delivery-bus-and-update-ordering.md`'s note that _"the React `createRoot`
case remains latent: marking React unsafe reaches every framework-less project, because
`FALLBACK_FRAMEWORK` is `"react"`, and it regressed `vanilla-spa-basic`. The fix is one facet field
away once there is a reproduction to justify it."_ This may be that reproduction. Not chased further
in this pass — flagged for whoever picks it up next.

**The two `rsbuild-spa` failures** (runs 1 and 9, both `[Locale Switch]`/`[Locale Switch Storm]`,
"Execution context was destroyed... navigation") are the pooled-dev-server watcher-reload race this
same ledger already explains a few sections up ("The `locale-switch` observation, resolved — and it
was the watcher"). Confirmed recurring, not new.

**What remains open.**

- §2.4's original hypothesis — neither confirmed nor denied. The instrumentation is safe to leave in
  permanently (silent, negligible cost) and the next attempt should either budget a larger batch
  (roughly 15–20 runs for even odds of one `hmr-hammer` hit) or find a way to target the write
  pattern more precisely than full-suite contention.
- The React `createRoot`/`entryReexecutionSafe` gap — a new, evidenced lead, not this pass's to
  chase.
- `DEBUG=zintl:vite` silently suppressing `handleHotUpdateHook` — real, reproducible, entirely
  unexamined.

---

## Phase 5 — formal support: the two defects that had to go first

Proposal 029 takes up 028 §6.1's HMR facet seam. Two defects surfaced while scoping it, both on the
supported path, both older than this phase, and neither reachable from the seam work itself — so they
are recorded here rather than folded into it.

### L-024 — the dev/build discovery gate was a Vite artifact, so every Rsbuild rebuild re-discovered

|                             |                                                           |
| :-------------------------- | :-------------------------------------------------------- |
| **Status**                  | **Fixed**                                                 |
| **Bucket**                  | **2 — ask the layer that knows**, the same shape as L-020 |
| **Facet contract changed?** | No                                                        |

`hooks/build.ts` decided whether to run the full `discover()` pass with:

```ts
if (!ctx.server) {
  await ctx.compiler.discover();
}
```

`ctx.server` is assigned in exactly one place — `configureServerHook`, a Vite hook. So the test reads
"am I in a Vite dev server", and it was standing in for "am I building". **On Vite the two agree
exactly**, in dev, in `build`, and in `preview`, which is why this survived unexamined: there was no
input that could tell them apart.

On Rsbuild they come apart completely. Nothing assigns `ctx.server`, so `!ctx.server` is true in dev
too — and `buildStart` is not a once-per-process hook there. Unplugin taps it to
`compiler.hooks.make`, which fires **once per compilation**, so a watch-mode rebuild ran a full
project discovery pass before building a single module. Exactly inverted from what an incremental
hot-update path is for, and it would have made any measurement of Rspack hot updates meaningless —
the discovery would have masked whether incremental invalidation worked at all.

The fix is L-020's answer applied to a second question: ask the layer that actually knows. `isDev` is
truthful on Rsbuild as of L-020's `hostHints` merge, so `if (!ctx.compiler.isDev)` is a
behaviour-preserving swap on Vite and a correction everywhere else. Confirmed by the full unit suite
passing with no snapshot churn.

**The generalisation worth keeping**: a Vite-shaped field used as a proxy for a host-neutral question
is the same defect as a hardcoded `import.meta.hot`, just harder to grep for — there is no wrong
_string_ in the output to find, only a right answer reached for the wrong reason. L-004 removed one
of these (`\0` recognition resting on a `node_modules` coincidence). This is the second.

### L-025 — four hardcoded `import.meta.hot` literals in the asset branches, past the facet

|                             |                                            |
| :-------------------------- | :----------------------------------------- |
| **Status**                  | **Fixed**                                  |
| **Bucket**                  | **1 — declare it**                         |
| **Facet contract changed?** | No — uses `hmrSelfAcceptCode` as it stands |

`hooks/resolve.ts` wrote Vite's HMR API out as a string literal at four sites — the `?raw` /
`?zintl-raw` localized-asset branches, and the `?raw` Proxy module. This is the same class of leak
L-014/L-015/L-016 found in the _codegen_ hooks and that `rspackFacet` was created to stop; it stayed
open here only because nothing had asked a second host to load a localized asset in dev, and
`rsbuild-spa` claims `assets` but not `hmr`.

L-014's own entry is the tell. It recorded the dev-guard being _missing_ at the fourth site, so the
literal reached an Rspack production bundle — and fixed that by adding `ctx.compiler.isDev ? … : ""`.
Correct as far as it went, and it left the deeper problem in place: dev-guarding Vite's API still
emits Vite's API, now merely at a moment nobody was checking. The guard made the symptom invisible
rather than the cause absent.

All four now route through a single `selfAcceptCode(ctx)` helper reading
`_resolved.system.hmrSelfAcceptCode`. `viteFacet`'s no-argument return is **byte-identical** to the
three one-line literals it replaces, so the change is provably inert on the supported host — 791 unit
tests, zero snapshot churn. On Rspack it was previously emitting a reference the host never defines;
it now emits whatever that facet declares, which as of proposal 029 is `import.meta.webpackHot`.

Where no bundler facet contributes, the helper emits nothing, matching `stateToHooks()`'s documented
"emit nothing" default rather than falling back to somebody's API. Note this leaves core's own
no-facet path at `compiler/src/index.ts` still hardcoding `selfAcceptHmrSnippet` — inconsistent, but
pre-existing and out of this phase's scope.

### L-026 — a normalized id handed to a filesystem, and it did visible damage

|                             |                                                         |
| :-------------------------- | :------------------------------------------------------ |
| **Status**                  | **Fixed**                                               |
| **Bucket**                  | **1 — declare it** (an id's _kind_, not just its value) |
| **Facet contract changed?** | No                                                      |

Found while building proposal 029's declared-dependency mechanism, and it is the most instructive
failure of that work because nothing about it looked like a failure.

`messages.boundaryOwnership` is keyed by `io.getNormalizedId`, which **strips the source extension**:
`src/main.ts` is stored as `src/main`. That is right, and deliberately so — boundary identity is
content-based and must not move when a file is renamed `.ts` → `.tsx`. It is wrong for anything that
hands the string onward to a filesystem, and `getBoundaryInputs` did exactly that.

**What made it worth an entry is the failure mode.** Rspack accepted the dependency without
complaint, found no such file, and logged `building removed src/main` on every cycle — a watch on a
path that can never exist. Nothing crashed. The generated catalog simply never went stale, so in the
browser the entry re-executed with the _new_ message key while the catalog it read still held the
old one. The lookup missed, and because Zintl has no source-locale fallback — by design, SPEC's first
principle — the heading rendered **empty**. A correct architectural decision (no fallback) turned a
silent staleness bug into a visibly blank page, which is the outcome that principle exists to
produce; the diagnosis still took a probe, because the log line naming the cause was Rspack's and
said `removed`.

`ZintlCompiler.resolveSourcePath` probes `io.resolvedExtensions` — public with the doc comment "for callers
that probe extensionless dep ids", so the need was anticipated, just not wired here — and returns
`undefined` rather than guessing, so a caller declares no dependency instead of a false one.

**The generalisation**: this codebase has two kinds of string that both look like paths. A normalized
id is an _identity_; a source path is a _location_. They are the same type and differ by an
extension, so nothing catches the substitution — the third instance of this shape in this ledger
after L-004 and L-024.

### L-027 — discovery raced itself once the flag moved ahead of the await

|                             |                                  |
| :-------------------------- | :------------------------------- |
| **Status**                  | **Fixed**                        |
| **Bucket**                  | **2 — ask the layer that knows** |
| **Facet contract changed?** | No                               |

A defect introduced _by_ L-024's fix and caught by the contract suite, recorded because the wrong
shape is the intuitive one.

L-024 replaced `if (!ctx.server)` with a `discovered` flag. Written the obvious way, that sets the
flag and then awaits:

```ts
if (!ctx.discovered) {
  ctx.discovered = true;
  await ctx.compiler.discover();
}
```

Correct on Vite, where `buildStart` runs once and nothing else is in flight. Wrong on Rspack, where
`buildStart` is tapped to `compiler.hooks.make` — **a parallel hook**. Module building starts while
this is still awaiting, `transformHook` finds the flag already `true`, skips, and transforms against
a null `boundaryGraph`. It surfaced as `TypeError: Cannot read properties of null (reading 'nodes')`
inside a loader chain, in _production_ builds as well as dev.

The fix is the shape the compiler already uses one layer down: share the in-flight **promise**, not a
flag. `invalidateForUpdate`'s custody logic makes the same move for the same reason (ZDB Axiom D3),
and its comment says it outright — _"The promise is what is shared, not a cached result, because the
first pass is usually still running when the second arrives."_ `ensureDiscovered(ctx)` in
`hooks/build.ts` is now the single entry point, awaited by both `buildStart` and `transformHook`.

**Worth carrying forward**: "run once" and "run once, and make everyone else wait for it" are
different requirements, and a boolean can only express the first. Any host with a parallel lifecycle
hook turns the difference into a crash.

### L-028 — a pull served stale while a push for the same boundary was in flight

|                             |                                                           |
| :-------------------------- | :-------------------------------------------------------- |
| **Status**                  | **Fixed**                                                 |
| **Bucket**                  | N/A — a runtime defect, not a host leak                   |
| **Facet contract changed?** | No                                                        |
| **Affects**                 | **Both hosts.** Latent on Vite; Rspack made it reachable. |

The one entry here that is not about a bundler at all, and the most valuable one for that reason.

**What was seen.** During the proposal 029 dev-server verification, one edit in four on
`examples/rsbuild-spa` at `?lang=ar` left the `<h1>` **empty** — and left it empty. The delivery
ledger showed the fresh catalog `applied`. The store held the new key. The DOM did not, and nothing
ever repaired it.

**Not reproducible by repeating the symptom.** Twenty-two automated edits across two timing profiles
— generous settle, and reload-then-edit-immediately — produced zero empties. Chasing a race by
waiting for it to land again is how a defect gets recorded as "flaky" and left; the reproduction had
to be built out of the _mechanism_ instead.

**The mechanism, then confirmed deterministically.** The receiver has two ways in, and only one of
them publishes what it is doing:

| Path               | Started by                           | Records itself in                |
| :----------------- | :----------------------------------- | :------------------------------- |
| `registerLoader`   | a generated manager, as it evaluates | `pendingBoundaries` **only**     |
| `loadLazyBoundary` | `zintl()`                            | `pendingBoundaries` + `inFlight` |

`loadLazyBoundary` joins a concurrent load through `inFlight` — which `registerLoader` never wrote
to — and it tested "already loaded" **before** "already loading". So a pull arriving during a push
was handed whatever was already present. A probe driving the real runtime in a real browser
(`registerLoader` with a 250 ms loader, then an immediate `loadLazyBoundary`) reported
`inFlight: []`, `pending: [b_src_main_render]`, and a pull that returned in **0 ms** without the
catalog that was already on its way.

**Why the symptom was blankness rather than staleness.** The entry re-executes with the _new_ message
key and looks it up in the _old_ catalog. There is no source-locale fallback — SPEC's first
principle — so the miss renders `""`. The architecture converted a silent staleness bug into a
visibly blank page, which is the outcome that principle exists to produce; it also means the failure
mode is unmistakable once seen, and permanent, since nothing re-renders after the late `addCatalogs`.

**Why Vite never showed it.** Vite re-imports the whole dependency chain with a fresh `?t=`, so the
content module has applied before the entry re-renders — the ordering that makes the race harmless
is Vite's, not Zintl's. Rspack re-executes the manager and the entry as independent modules and the
content module for a non-source locale sits behind a dynamic import, so the two genuinely interleave.
The pre-existing comment on this branch said as much and drew the wrong conclusion from it:

> _"Known limitation: this also skips a refresh… It does not bite in development, where hot updates
> push catalogs straight into `addCatalogs` rather than coming back through here."_

True of one host. The clause "does not bite in development" was carrying an unstated "on Vite".

**The fix.** `registerLoader`'s async path publishes itself in `inFlight`, and `loadLazyBoundary`
checks `inFlight` **before** the already-loaded test. The ordering is the fix, not a tidy-up: a load
is outstanding precisely because something decided the present catalog needs replacing, so answering
from the present one chooses the older of two known states — the inverse of Axiom D1, reached by a
different route than `delivery-ordering` covers.

**Guarded by `tests/contracts/delivery-refresh.contract.spec.ts`**, which drives the interleaving
through the store on purpose rather than waiting for it. Verified in both directions: five projects
fail without the fix, five pass with it. **Four of those five are Vite** — this was never an Rsbuild
defect, only an Rsbuild sighting.

**The transferable lesson.** A comment asserting "this cannot bite" is a claim about the environment,
and it inherits every assumption the environment happens to satisfy. A second host is what turns such
a comment back into a question — which is the whole thesis of 026, arriving here two proposals later
by a route nobody planned.

**Status correction — the class is half closed.** The fix above covers the interleaving where a load
is _in flight_. A second one is open and reproduces deterministically (3/3, real dev server, after
clearing `node_modules/.zintl`): on the **source locale**, whose manager carries its catalog inlined
and synchronously, the entry re-executes and misses _before any load starts_. The catalog then
arrives correctly (`catalogHasNewKey=true`, beacon 4 → 14, no reload) and the heading stays `""`,
because nothing re-renders. Two candidate fixes — mirroring `_t`'s server branch in its browser
branch, and unioning the boundary graph into `getBoundaryInputs` — were written, measured, and
**reverted unvalidated**: neither changed the outcome. Both were wrong for the same reason — they
assumed the fresh catalog never arrived, and it does. **L-030 is what it actually is.**

### L-029 — the contract harness reloads where a real dev server hot-updates

|                             |                                 |
| :-------------------------- | :------------------------------ |
| **Status**                  | **Open** — diagnosed, not fixed |
| **Bucket**                  | N/A — a harness defect          |
| **Facet contract changed?** | No                              |

Found while establishing whether `memory-leak`'s failure on `rsbuild-spa` was throughput or a stall.
It was neither.

**Measured, per iteration**: `mutation=10220ms`, `assert=16ms`. The DOM is correct almost instantly;
the harness spends a flat ten seconds per edit, which is `waitForSettled`'s timeout. Four iterations
fit in the 45s budget, so the contract can never reach twenty. Raising vitest's `testTimeout` changes
nothing, because the 45s is `tests/vitest.config.ts`'s own.

**Why the beacon never confirms**: every edit **reloads the page** in this harness. Measured with a
`globalThis` sentinel that does not survive, a store whose `version` returns to `1`, and a ledger
that returns to 4 entries. `waitForSettled` compares the beacon with `!==` precisely so a reload's
reset still counts as progress — but a reload landing on the _same_ value every time defeats that
test, so it waits out the full timeout and falls through to the idle heuristic.

**The reload is the harness's, not the host's.** Driving the same programmatic
`createRsbuild().startDevServer()` against the real `examples/rsbuild-spa` directory hot-updates
cleanly — sentinel survives, beacon advances 4 → 12. The copy under `.tmp/runs/w<id>/`, with its
`node_modules` symlink farm, is the remaining difference and the place to look.

**What this costs today**: `hmr` and `hmr-stress` pass on `rsbuild-spa`, but in this harness they are
converging via reload rather than via a hot update. They verify the user-visible outcome without
proving the mechanism — so the capability claims are not _wrong_, they are weaker than they read.
Recorded on the manifest beside the claims themselves rather than only here.

### L-030 — `loadI18nInstance` builds a new store on every entry re-execution

|                             |                                                                             |
| :-------------------------- | :-------------------------------------------------------------------------- |
| **Status**                  | **Open** — root cause established, fix not attempted                        |
| **Bucket**                  | **1 — declare it** (a host-specific acceptance decision)                    |
| **Facet contract changed?** | Not yet — but this is where it would change                                 |
| **Affects**                 | Both hosts in principle; only Rspack in practice. See "why Vite is immune". |

The answer to L-028's open half, and it is not where either guess looked. It was found by tagging the
store object in the page and comparing identity across a hot update, rather than by reading more code.

**Measured.** After one edit on the source locale, against a real dev server:

```
__zintl_active === tagged store : false   (the store object was replaced)
keys on tagged store            : 4 keys, all stale
keys on active store            : 5 keys, including the new one
final heading                   : ""
event order                     : one h1 render at 51.5ms, and nothing else
```

The fresh catalog **does** arrive. It arrives on a _different store_ than the one that rendered.

**The mechanism, end to end.**

1. `packages/compiler/src/runtime/internal.ts:44` — `loadI18nInstance` opens with
   `const store = new I18nStore()`. It builds a **new store every call**, unconditionally, and
   publishes it as `__zintl_active`.
2. The entry calls `loadI18nInstance(...)` inside `render()`, and the entry self-accepts, so **every
   hot update re-runs it** and discards everything the previous store had accumulated.
3. The generated manager also self-accepts (`hmrSelfAcceptCode` is appended to it). On webpack a
   self-accepting module **stops the update propagating to its importers**, so the manager's update
   does not oblige the entry to re-require it.
4. Webpack re-executes the entry before the manager. The entry's `import _zintl_mgr from …` resolves
   through `__webpack_require__`, which returns the **module instance cached at that moment** — the
   old manager, still holding the old inlined catalog.
5. `loadI18nInstance` seeds its brand-new store from that stale loader (step 4 of its own body, the
   "synchronous boost"), so the new store gets four old keys.
6. `_t("<new text>")` misses. No source-locale fallback, by design, so it renders `""`.
7. The fresh manager evaluates a moment later and calls `registerLoader` on the now-active store,
   which is why the store ends with five keys. Nothing re-renders, so the blank persists.

**Why Vite is immune.** Its entry re-imports the manager by URL with a fresh `?t=`, so step 4 cannot
yield a stale instance — the loader handed to `loadI18nInstance` is always current, and rebuilding the
store from scratch is therefore harmless rather than lossy. The store-discarding behaviour in step 1
is equally present on Vite; it is simply never observable there. Another "does not bite" that was
carrying an unstated "on Vite", exactly like L-028's.

**Where the fix belongs, and why it is not attempted here.** Two candidates, and choosing between them
needs evidence this entry does not have:

- **Stop discarding the store.** `loadI18nInstance` could reuse the active instance when one exists
  rather than constructing a new one. Attractive because it makes step 5 harmless on any host — but
  it changes SSR request-scoping semantics, where a fresh store per call is the point.
- **Stop the manager self-accepting on webpack.** If the manager did not accept, its update would
  bubble to the entry, webpack would dispose it, and step 4 would yield a fresh instance — Vite's
  semantics, reached by webpack's own rules. This is the more precise fix and it is genuinely
  host-specific, which is what makes it a facet concern. The obstacle is that `hmrSelfAcceptCode`
  does not know which _kind_ of generated module it is decorating, so expressing "accept content
  modules, decline manager modules" needs the hook to take that argument.

Recorded rather than fixed because two speculative fixes have already been reverted on this defect
(L-028's correction), and the discipline that finally produced the diagnosis was measuring identity
instead of guessing at mechanism.

#### Attempted and rejected: reusing the store

The first of L-030's two candidates was implemented, measured and reverted. Recording it because a
negative result here is worth more than the guess it replaces — this is the third fix attempt on this
defect, and the first one that failed for a _stated, verified_ reason rather than an unexamined one.

**The change.** `loadI18nInstance` reused the live store instead of constructing a new one, gated on
three conditions so the reuse could not do damage elsewhere: client only (SSR keeps a fresh store per
call, because request scoping is the whole point of `AsyncLocalStorage` there); an existing store must
be present; and **its locale must match the requested one**, since a store holds a single `locale` and
two anchors on different languages — `zintl("fr")` nested inside `zintl(locale)` — would otherwise
overwrite each other's.

**Measured result: the reuse lands and the render is still blank.**

```
store reused across update : true
page reloaded              : false
catalog has new key        : true (5 keys)
heading                    : ""
```

**Why it cannot work**, which the measurement then confirmed: discarding the store was never the
operative cause. The blank comes from the _loader_ being stale, and reuse makes that strictly no
better — worse, it takes the loader out of play entirely, because the module-level `registerLoader`
(`store-core.ts`, the one `loadI18nInstance` calls) opens with

```ts
if (instance.catalogs[target]?.[boundaryId]) return;
```

so a reused store already carrying that boundary means the loader is never even invoked. A fourth
"already present, skip the refresh" gate, joining the three L-028 catalogued.

**Costs, for completeness.** It also churns nine production-output snapshots — the runtime ships — and
the run showed `memory-leak` on `react-basic` failing on convergence (`full-reload: 1`, beacon stuck
at 2). That is the same signature L-023 already records as open and flaky, and it was observed in this
same session _before_ this change existed, so it is **not attributable** either way. Noted rather than
claimed, and it did not affect the decision: a change that does not fix the defect does not earn a
runtime behaviour change regardless.

**What remains.** L-030's second candidate — stopping the generated manager from self-accepting on
webpack, so its update bubbles to the entry and webpack hands the entry a fresh instance — is now the
only live one, and it is the one the evidence points at: it addresses the stale loader directly.

#### Attempted and rejected: declining self-acceptance on the manager

L-030's second candidate, implemented and reverted. It **fixed the case it targeted and broke the
other one**, which is the finding — the two are in direct tension, and neither this entry nor L-030
had seen that.

**The change.** `BundlerFacet.hmrSelfAcceptCode` gained a `kind` argument (`"content" | "manager"`),
so a facet could decide per module kind. `viteFacet` ignored it, with a comment saying why. `rspackFacet`
returned `""` for `"manager"`: declining to accept hands the update to the importer, so Webpack
disposes the manager, re-executes the entry, and the entry's `__webpack_require__` re-instantiates a
fresh manager — Vite's behaviour reached by Webpack's own rules.

**Measured, five consecutive edits per locale, `node_modules/.zintl` cleared each run:**

| Locale                       | Manager accepts (control) | Manager declines (the change) |
| :--------------------------- | :------------------------ | :---------------------------- |
| `en` — source, inlined, sync | **3/3 blank** (L-030)     | **0/5 blank** ✅              |
| `ar` — lazy, dynamic import  | **0/5 blank**             | **3/5 blank** ❌              |

**Why it cannot be a per-host boolean.** The manager's self-acceptance is _load-bearing for lazily
loaded locales_: re-executing the manager module is what re-runs its IIFE, which calls `registerLoader`,
which invokes the loader, which dynamically imports the fresh content chunk. Remove the acceptance and
that refresh never happens — the `ar` runs show `catalogHasNewKey=false`, the catalog genuinely never
arrives, which is a strictly worse failure than L-030's (where it arrived too late).

So the _same_ acceptance simultaneously:

- **refreshes** the lazily-loaded locales, by re-running the manager, and
- **strands** the source locale, by stopping the update before it reaches the entry that captured the
  manager by value.

**What this rules out, and what it points at.** The fix is not "who accepts" — both answers are wrong
for one locale each. It is that **the entry captures the loader by value**: the transform emits
`loaders: { [bId]: _zintl_mgr_<b>.loader }`, freezing whatever module instance the importer resolved.
`registerLoader` already maintains `globalRegistry`, a module-scope map that survives hot updates and
always holds the most recently registered loader. An entry that resolved its loader _through that
registry at call time_ would be immune to holding a stale module object, and neither locale's path
would need to change. That is the next thing to try, and unlike the previous two candidates it
addresses the capture rather than the propagation.

**Both rejected candidates share one lesson**, worth more than either: L-030's diagnosis correctly
identified _what_ the entry ends up holding, and both fixes then guessed at _which mechanism to
suppress_ rather than at _why the value was captured at all_. The A/B above is what surfaced it, and
it cost one run per candidate.

#### Ruled out without implementing: resolving the loader through `globalRegistry`

The third candidate, and the first one disproved by measurement _before_ being written — which is the
only reason it cost one run instead of a build, a suite and a revert.

**The idea.** The entry captures its loader by value
(`loaders: { [bId]: _zintl_mgr_<b>.loader }`), freezing whichever module instance the importer
resolved. `globalRegistry` (module scope in `store-core.ts`) survives hot updates and always holds the
most recently registered loader, so resolving through it _at call time_ should hand the entry
something current no matter which module object it happens to hold.

**Why it cannot work.** It only helps if something fresher has been registered by the time the lookup
happens. Instrumenting `I18nStore.prototype` — rather than the instance, which
`loadI18nInstance` replaces on every entry re-execution — gives the ordering directly:

```
56.5ms  addCatalogs             carriesNewKey=false    ← entry seeds from the stale loader
57.6ms  RENDER                  text=""                ← entry renders and misses
85.6ms  manager.registerLoader  loaderIsFresh=true     ← fresh manager, 28ms later
85.7ms  addCatalogs             carriesNewKey=true     ← fresh catalog, too late
```

At 57.6ms the registry contains only the stale loader; the fresh one does not exist until 85.6ms. A
lookup at render time returns precisely what the entry already had.

**What the number actually establishes**, and it is worth more than the rejected candidate: **no
ordering-based fix can work.** The three candidates so far each tried to get a fresher value into the
entry _before_ it renders — by not discarding the store, by changing who accepts, by resolving late —
and the render happens 28ms before the fresh value exists on any of those paths. The entry cannot be
made to render correctly by giving it a better source to read from, because at the moment it reads,
nothing better exists anywhere on the page.

**Which leaves exactly one shape.** The late arrival has to cause a **re-render**, rather than the
render being made to wait for it. The store already publishes the signal — `addCatalogs` calls
`notify()`, and `loadI18nInstance` returns a `subscribe`. Framework runtimes are wired to it through
`clientReactivityImports`, which yields a **hypothesis worth testing before designing anything**: this
defect may be confined to _non-reactive_ entries, i.e. vanilla apps re-assigning `innerHTML`, which
subscribe to nothing and therefore cannot repaint when the catalog lands. `rsbuild-spa` is vanilla and
is the only Rspack example, so the framework half of that hypothesis is currently **untested on this
host** — stated as a hypothesis, not a finding.

If it holds, the fix is a codegen concern rather than a runtime one: an entry that Zintl knows is
re-executable (`entryReexecutionSafe`) and has no framework reactivity behind it should subscribe and
re-run its own render. That is proposal-sized, and it should be designed rather than patched — three
patches to this defect have now been reverted, and each was aimed at a mechanism rather than at the
missing repaint.

#### The vanilla-only hypothesis: supported, but not for the stated reason

Tested, and the testing corrected the hypothesis twice before it produced an answer. Both corrections
are recorded because each was a probe defect that would have been reported as a product finding.

**Attempt 1 — invalid probe.** Added a store subscription to `rsbuild-spa`'s entry and A/B'd it
against the unmodified app: 4/4 blank both ways, "hypothesis refuted". The probe guarded its
`subscribe` call with a `globalThis` flag, which **survives module re-execution** — so the re-executed
entry never re-subscribed and the listener stayed attached to the store `loadI18nInstance` had already
replaced. A framework re-subscribes on every mount; the probe subscribed once, ever.

**Attempt 2 — corrected flag, still invalid, and the correction is the finding.** Module-scope flag,
so the entry re-subscribes to the store that is active now: still 4/4 blank. Not a probe bug this
time — a category error in the analogy. In a vanilla app the subscriber's "re-render" calls
`render()`, which calls `zintl()`, which expands to `loadI18nInstance` — **so it builds yet another
new store, re-seeded from the same stale module binding, and renders blank again.** A framework
re-render does nothing of the sort: it re-runs components, which re-call `_t`, which re-reads the
store. Those are not the same operation, and treating them as one is what made both probes wrong.

**The measurement that settles it.** After the update has landed, with the DOM still blank:

```
DOM heading now         : ""
value a re-read returns : "Reread probe"
```

The store holds the correct string. Anything that merely _re-reads_ renders correctly; only something
that re-hydrates does not.

**So the hypothesis stands, with its reasoning replaced.** The dividing line is not "subscribes vs
does not". It is **what a re-render is**:

| Entry kind            | Re-render means                                                      | Outcome after the late catalog |
| :-------------------- | :------------------------------------------------------------------- | :----------------------------- |
| Framework             | re-run components → re-call `_t` → re-read                           | correct                        |
| Vanilla (`innerHTML`) | re-run `render()` → `zintl()` → **new store from the stale binding** | still blank                    |

**Consequences worth carrying forward.**

- **"Give vanilla a subscription" is not the fix**, and the A/B proves it: 4/4 blank with a correct,
  module-scoped subscription in place. Any fix must stop the re-render from re-hydrating, not merely
  cause one.
- The blast radius is smaller than L-030 assumed, but the _reason_ is not the one L-030 gave — so the
  hypothesis was right by accident, which is worth as little as being wrong on purpose.
- **Still not a direct test.** No framework app exists on this host, so the framework row above rests
  on the measured store contents plus reading what a framework re-render does, not on running one. An
  Rsbuild + React example would close it, and would be the honest prerequisite before scoping any fix
  to "vanilla only".

#### The vanilla-only hypothesis: **refuted** by direct test

`examples/rsbuild-react` was built to close the "no framework app on this host" gap, and the first
thing it measured overturned the entry above.

**React on Rspack, four consecutive edits to a heading that lives in a component:**

```
BLANK #1 heading="" reloaded=false
BLANK #2 heading="" reloaded=false
BLANK #3 heading="" reloaded=false
BLANK #4 heading="" reloaded=false
=== 4/4 bad renders (react, locale=en) ===
```

**So the defect is not confined to non-reactive entries**, and the blast radius is the whole Rspack
dev experience rather than an edge case. The reasoning that made "vanilla-only" plausible — a
framework repaint is a pure re-read, and a pure re-read demonstrably returns the correct string — is
still individually true at every step, and the conclusion is still false. Something prevents the
repaint from happening at all under React Fast Refresh; _what_ is now the open question, and it is a
better one than the previous entry's because it is about a measured failure rather than an inferred
immunity.

**The pattern across this defect is now unmistakable.** Four investigations, and each was undone by
the same move: reasoning from a correct mechanism to an unmeasured conclusion.

| #   | Claim                                   | Fate                                                                        |
| :-- | :-------------------------------------- | :-------------------------------------------------------------------------- |
| 1   | discarding the store causes it          | reverted — `registerLoader` skips a present catalog anyway                  |
| 2   | the manager's self-acceptance causes it | reverted — fixed `en`, broke `ar`                                           |
| 3   | a registry lookup fixes it              | ruled out before writing — the fresh loader does not exist for another 28ms |
| 4   | only non-reactive entries are affected  | **refuted here** — React is affected too                                    |

Every one of those was argued from real code and real mechanism. The only two that produced anything
durable were the ones that started from a measurement: L-028's `inFlight` fix, and this example.

**What this example changes going forward.** Framework behaviour on Rspack is now measurable rather
than inferable, and it is claimed conservatively — `tests/manifests/rsbuild-react.ts` claims `build`,
`graph`, `transform`, `spa`, `boundary-graph`, `locale-switch` and `rtl`, and pointedly **not** `hmr`,
because `hmr` is exactly what it just demonstrated does not work here.

### L-031 — the harness ran its Rsbuild dev server in neither mode, and React could not boot

|                             |                                                        |
| :-------------------------- | :----------------------------------------------------- |
| **Status**                  | **Fixed** — and the fix invalidated a capability claim |
| **Bucket**                  | N/A — a harness defect                                 |
| **Facet contract changed?** | No                                                     |

Found the moment `examples/rsbuild-react` ran through the contract suite: every contract on it failed
on an empty page with `ReferenceError: process is not defined`, thrown out of React's own bundle
before anything rendered.

**The cause.** Rsbuild derives `mode` from `NODE_ENV`, and Vitest sets `NODE_ENV=test` — which is
neither value it recognises, so it emitted no `process.env.NODE_ENV` define at all. Invisible for a
vanilla app, fatal for React's development build, which reads that variable. `RsbuildDevServerDriver`
now sets `mode: "development"` explicitly, which is worth stating regardless of the bug: a driver
whose job is starting a dev server should not describe itself as a test run.

**This fix closes L-029, and closing it retracted a claim.** With the mode set correctly, the harness
stops reloading on every mutation and performs genuine hot updates — which is what L-029 asked for.
The immediate consequence is that `hmr` on `rsbuild-spa` **now fails honestly**, on L-030:

```
expected '' to contain 'HMR works!'
settle beacon: 12   delivery ledger: 12 entries   catalogs applied   no reload
```

`hmr` and `hmr-stress` have accordingly been **dropped from `rsbuild-spa`'s manifest**. They were
passing because the page reloaded, and a reload converges on the right text without exercising a
single thing those contracts exist to verify.

**What remains true**, and worth separating from what does not: hot updates on Rsbuild _do_ work
against a real `rsbuild dev`, verified by hand in proposal 029 §4 with a sentinel proving no reload.
What was never true is that the contract suite demonstrated it. Two statements that a green suite made
look like one.

**The lesson this one carries.** L-029 was recorded as "the harness reloads where a real dev server
hot-updates" and treated as a harness inconvenience keeping `memory` unclaimable. It was actually
holding up two capability claims that were not earned. A harness bug that makes tests _pass_ is worth
more attention than one that makes them fail, and it is much easier to leave alone.

#### Attempt 4: entry-only acceptance — and the acceptance matrix is now complete

The most principled candidate yet, and it half-works like the others. Reverted, but it completes a
table that rules out the entire approach rather than one more point in it.

**The idea.** On Webpack an update stops at the module that accepts it, and that module becomes its
own update root, applied _beside_ the entry rather than beneath it. So let **nothing Zintl generates
accept** — every update bubbles until it reaches the entry, which is the only acceptance point, and
Webpack disposes the whole chain beneath it first. The entry then re-executes with fresh managers and
fresh content modules underneath, which is exactly the state Vite reaches by re-fetching each module's
URL with a new `?t=`.

**Measured, four consecutive edits per cell, `.zintl` cleared per run:**

| manager | content | `en` (inlined, sync) | `ar` (lazy, async chunk) |
| :------ | :------ | :------------------- | :----------------------- |
| accept  | accept  | ✗ 3/3 blank          | ✓ 0/5                    |
| decline | accept  | ✓ 0/5                | ✗ 3/5 blank              |
| decline | decline | ✓ 0/4                | ✗ 4/4 blank              |

**`en` requires the manager to decline; `ar` requires it to accept.** That is a direct contradiction,
so **no acceptance policy fixes both** — the fourth approach is not one more failed guess but the
exhaustion of a category.

**Why `ar` still fails under decline/decline**, which is the new information. The entry _does_ wait:
`registerLoader` returns its promise, `loadI18nInstance` pushes it into `promises` and awaits
`Promise.all`. And the catalog _is_ correct afterwards — the probe reports `hasKey=true` on the store
with the DOM still blank. So the awaited `import()` resolved the **stale cached async chunk**: Webpack
had not disposed it, because an async chunk's update is applied on its own schedule regardless of what
the importer does.

**Which names the next candidate precisely.** The content module's specifier is constant across
generations (`virtual:zintl/content/<locale>/<boundary>`), so a dynamic import after an update can
legitimately return the cached module. Vite never has this problem because its specifier carries
`?t=<timestamp>` — a _different module_ every update. The equivalent here is to stamp the generated
dynamic-import specifier with `catalogGeneration` in dev, so `import()` cannot resolve a stale chunk
by construction.

Two risks to settle before writing it, neither cosmetic: `resolveId`/`load` parse that path with a
fixed regex, and unplugin materialises virtual ids as **real filenames** under `node_modules/.virtual`
— so whatever the stamp looks like, it has to survive both parsing and the filesystem. That is why
this is written down rather than attempted at the end of a long session.

**Score so far on this defect: four approaches, four reverts, and a much smaller remaining search
space.** The one thing that has never failed is measuring before concluding.

#### Attempt 5: generation-stamped content specifier — and the invariant that ends the search

Implemented, measured in three configurations, reverted. Both named risks turned out to be
non-issues, and the change still does not fix the defect — but the five attempts together now
establish something none of them established alone.

**The risks were real and both cleared.** `encodeVirtualModuleId` uses `encodeURIComponent`, so a `?`
becomes `%3F` and survives as a filename; and `resolveIdHook` passes the id through whole while
`loadIncludeHook` and `loadHook` both split on `?` before matching. The stamp needed **no parser
changes**, which is the one prediction in this whole sequence that held.

**Measured, four edits per cell:**

| acceptance        | stamp | `en` (inlined) | `ar` (lazy) |
| :---------------- | :---- | :------------- | :---------- |
| accept / accept   | no    | ✗ 3/3          | ✓ 0/5       |
| accept / accept   | yes   | ✗ 4/4          | ✓ 0/4       |
| decline / decline | no    | ✓ 0/4          | ✗ 4/4       |
| decline / decline | yes   | ✓ 0/4          | ✗ 4/4       |

The stamp is **inert**: `ar` already worked wherever the manager accepted, and the stamp does not
rescue it where the manager declines. `en` continues to depend only on the manager declining, which
`ar` cannot tolerate.

**The invariant, which is the actual result of five attempts.** Every failing cell reports the same
thing, and it is worth stating exactly because it is what rules out the entire family of fixes tried
so far:

```
hasKey=true    catalog fresh in the store
errs=[]        no console errors
h=""           DOM blank
reloaded=false no page reload
```

**In every configuration, the correct catalog reaches the store and the render has already happened.**
Module identity, acceptance policy, store lifetime, loader resolution — five approaches moved _which_
module or _which_ store carried the value, and not one moved the render later or the value earlier.
On this host the entry's render precedes the freshest catalog, and nothing that only changes
_where the value comes from_ can change that.

**So the fix is a repaint, and the repaint has to be built.** The `notify()`/`subscribe` signal exists
and fires; what does not exist is anything on the page listening to it — `useSyncExternalStore` is
absent from the generated React output on **both** hosts (checked in the committed dev-transform
snapshots for `react-basic` and `rsbuild-react` alike), so `clientReactivity` is not reaching these
projects at all. Vite hides this completely, because its ordering makes the first render correct and
no repaint is ever needed.

That is a codegen question — why `clientReactivityImports` produces no subscription in practice — and
it is the first candidate in this sequence that is not about hot-update plumbing. It should be
investigated before anything else is attempted here, and it wants a proposal rather than a patch.

**Five attempts, five reverts, one invariant, and a much better question.** Recording the cost
honestly: three of the five were argued from correct mechanisms to unmeasured conclusions, and the
two that produced durable value (L-028's `inFlight` fix, `examples/rsbuild-react`) both began with a
measurement.

### L-032 — reactivity was gated on an RSC directive, so no plain React app ever subscribed

|                             |                                                                        |
| :-------------------------- | :--------------------------------------------------------------------- |
| **Status**                  | **Fixed** — and it fixes L-030 for framework apps                      |
| **Bucket**                  | **1 — declare it** (a framework fact, asked of the facet)              |
| **Facet contract changed?** | Yes — `RuntimeFacet.serverComponents`                                  |
| **Affects**                 | **Both hosts.** Latent on Vite for the same reason as L-028 and L-030. |

The answer to L-030, found by asking a question none of the five previous attempts asked: not "why is
the catalog late" but "why does nothing repaint when it arrives".

**Two defects, stacked, each hiding the other.**

**(a) The gate was the wrong question.** `pipeline/resolve.ts` injected
`useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)` only when
`observation.isClientComponent` — which is literally:

```ts
isClientComponent: code.includes('"use client"') || code.includes("'use client'"),
```

That is a **React Server Components** directive. A plain React SPA never writes it. Measured across
this repository, exactly **one** file carries it — `examples/vinext-basic/src/components/locales.tsx` —
so the entire client-reactivity feature was reaching one module, and `react-basic`, `react-ssr` and
`rsbuild-react` subscribed to nothing at all.

Fixed by asking the framework instead of the file: `RuntimeFacet.serverComponents`, declared `true`
only by `nextjsRuntimeFacet`. Where a framework separates server components from client ones the
directive still gates injection; everywhere else every component is a client component, which is what
non-RSC React has always meant. Both gates move together — `resolve.ts` and `resolve-imports.ts` — or
a file imports a hook it never calls, or calls one it never imported.

**(b) The detection was too loose, and (a) was hiding it.** Turning the gate on immediately broke
every React example with `Invalid hook call`, thrown from `bootstrap`:

```
PAGEERROR: TypeError: Cannot read properties of null (reading 'useSyncExternalStore')
    at bootstrap (index.js:223)
```

`registerComponentFunction` marked the **outermost function containing any JSX**, with no name check —
so a bootstrap that merely calls `createRoot(el).render(<App />)` was marked a component. It now
requires a capitalised name, from the declaration or from the binding an expression is assigned to,
which is React's own rule. A function with no name is not marked: failing to subscribe degrades a
repaint, while injecting a hook into a non-component takes the page down, so the conservative
direction is the safe one.

**Result.** `hmr` now passes on `examples/rsbuild-react` and is claimed. Fourteen injections across the
regenerated React snapshots, **none** in a lowercase function.

**What this says about L-030, and about the vanilla-only hypothesis.** The hypothesis was refuted
earlier — React was affected too — and that refutation was _correct at the time_ for a reason nobody
had looked at: reactivity was globally broken, so React had no advantage over vanilla. With (a) fixed,
the original reasoning holds after all — a framework repaint re-reads the catalog and recovers, and
`rsbuild-spa` stays blank because a vanilla repaint re-runs `zintl()` and rebuilds the store from a
stale binding. So `hmr` remains unclaimed on `rsbuild-spa`, and the remaining defect there is narrower
and better understood than L-030 was.

**Why five attempts missed it.** Every one of them treated this as hot-update plumbing — store
lifetime, acceptance policy, module identity, loader resolution. The defect was in **codegen**, on a
path shared with Vite, and Vite's ordering meant the missing subscription never had a visible
consequence there. A second host did not introduce the bug; it removed the ordering that was
concealing it — which is the thesis proposal 026 was written to test, now demonstrated three times
over (L-028, L-030, L-032).

### L-033 — the vanilla case is blocked by framework mis-detection, not by hot updates

|                             |                                                                |
| :-------------------------- | :------------------------------------------------------------- |
| **Status**                  | **Open** — blocked on a prerequisite, mechanism validated      |
| **Bucket**                  | **2 — ask the layer that knows** (detection, not the hot path) |
| **Facet contract changed?** | No — the change that would need one is not landed              |

L-032 fixed the empty render for framework apps. `rsbuild-spa` stayed blank, and this entry is what
that turned out to be.

**Why a vanilla entry cannot recover.** A framework app repaints because a component re-reads the
catalog. A vanilla app's only repaint is re-running the entry — which re-runs `zintl()` →
`loadI18nInstance` → a new store seeded from the module binding Webpack has cached, i.e. the stale
manager. So re-execution is _harmless_ but not _sufficient_, and those are different questions.
`entryReexecutionSafe` only asks the first.

**The fix that follows, and it was validated.** Where re-execution is insufficient, the entry should
decline to accept, so the update bubbles to a full page reload — slower than a hot update, and
correct, which is the trade Vite already makes for frameworks whose mount is not replayable. Wiring a
`hasClientReactivity` argument into `hmrInjectionCode` and requiring it on Rspack does exactly that,
measured: `reloaded=true` on every edit instead of a silent blank.

**And it can never fire, because every project is React.** `FALLBACK_FRAMEWORK` is `"react"`, applied
whenever detection finds nothing — and `examples/rsbuild-spa` has **no React dependency at all**
(`@rsbuild/core`, `typescript`, `zintljs`). Its composition snapshot nonetheless reads
`frameworks: react`, with `react-extraction` and `react-codegen` resolved. Since `react.ts` is the
**only** preset declaring `clientReactivityImports`, "does this app have reactivity" is true for every
project in the repository, including ones with no components whatsoever.

So the signal is unusable until detection stops guessing React for a project that never mentions it.
The change was therefore **reverted rather than shipped inert** — correct, unreachable code with a new
facet parameter is worse than no code, and this ledger already records four reverts caused by
shipping ahead of the evidence.

**The prerequisite is known and separately risky.** Proposal 024 and L-023 both note the fallback:
_"marking React unsafe reaches every framework-less project, because `FALLBACK_FRAMEWORK` is
`"react"`, and it regressed `vanilla-spa-basic`."_ A probe here confirms the hazard from the other
direction — disabling the fallback made `rsbuild-spa` render blank even after a full reload, so the
React facets are currently doing work that a framework-less project depends on. Detection cannot
simply be tightened; what the vanilla path actually needs from `react-codegen` has to be identified
first.

**Where that leaves L-030.** Fixed for framework apps (L-032, `hmr` claimed on `examples/rsbuild-react`).
Open for vanilla apps on Rspack, behind a detection prerequisite rather than behind the hot-update
machinery — which is a different and much smaller problem than the one this ledger started with.

### L-034 — framework detection guessed React, and two extraction targets were why it had to

|                             |                                                                                         |
| :-------------------------- | :-------------------------------------------------------------------------------------- |
| **Status**                  | **Fixed**                                                                               |
| **Bucket**                  | **2 — relocate it**: applying stays synchronous, announcing moves off the caller's turn |
| **Facet contract changed?** | No — but `zintljs/facets` loses two exports                                             |
| **Unblocks**                | L-033, and proposal 024's React `entryReexecutionSafe` item                             |

`detectFrameworksOrFallback` returned `[FALLBACK_FRAMEWORK]` — `"react"` — whenever detection found
nothing. So a project that never mentions React was assembled with React extraction and codegen, and
three separate items were stuck behind that:

- **L-033.** `react.ts` is the only preset declaring `clientReactivityImports`, so "does this app have
  client reactivity" was true for _every_ project, including ones with no components at all. The
  question could not be asked, so the vanilla hot-update fix could not be gated on it.
- **Proposal 024 / L-023.** Marking React's entry re-execution unsafe was tried and reverted, because
  the claim reached every framework-less project and made `vanilla-spa-basic` full-reload on every
  edit.
- **Plain wrongness.** `examples/rsbuild-spa` has no React dependency — `@rsbuild/core`, `typescript`,
  `zintljs` — and its composition snapshot read `frameworks: react`.

**What the guess was actually load-bearing for**, which is the part worth recording. Removing it alone
broke `vanilla-ssr` and `ssr-streaming`: they rendered untranslated. Not JSX, not codegen — **two
extraction targets**. `react-extraction` lists `obj:field:title` and `obj:field:text`;
`vanilla-extraction` lists `label`, `description`, `tooltip`, `placeholder` and neither of those two.
`examples/vanilla-ssr/src/entry-server.ts` uses a `text:` field, so it had been relying on React
extraction it never asked for.

Object-field extraction has nothing React-specific about it. The two targets moved to the vanilla
facet — which applies to every project — and the guess had nothing left to carry.

**A near-miss worth recording.** An earlier probe disabled the fallback and reported `rsbuild-spa`
rendering blank _even after a full reload_, which was written up as "the React facets are doing work a
framework-less project depends on". That was an artifact: the probe had left the example's catalog
reconciled to earlier probe keys. A clean run renders `"Get started"` correctly. The conclusion was
right by luck and for the wrong reason — the dependency was real, but it was two extraction targets in
a different example, not anything structural.

**Removed rather than deprecated.** `FALLBACK_FRAMEWORK` and `detectFrameworksOrFallback` are gone
from `zintljs/facets`; `detectFrameworks` is the single entry point and returns `[]` honestly. The
test harness now writes a `package.json` into synthesized projects, so a fixture that means "a React
project" declares React — which is what a real one does, and what the guess had been papering over.

**Verified.** 798 unit tests, 142 contract cases, all green. Detection now reports `react` for
`react-basic`/`react-ssr`/`rsbuild-react`, `svelte` for the Svelte examples, and `(none)` for the
eleven genuinely framework-less projects that had been mislabelled.

### L-035 — a non-reactive entry must decline the update, not accept and render empty

|                             |                                                      |
| :-------------------------- | :--------------------------------------------------- |
| **Status**                  | **Fixed** — closes L-030 for vanilla apps            |
| **Bucket**                  | **1 — declare it**                                   |
| **Facet contract changed?** | Yes — `hmrInjectionCode` gains `hasClientReactivity` |
| **Unblocked by**            | L-034                                                |

The last of L-030. L-032 fixed framework apps by making them subscribe again; `rsbuild-spa` is vanilla
and has nothing to subscribe.

**The distinction the code was missing.** `entryReexecutionSafe` asks whether re-running an entry is
_harmless_. Nothing asked whether it is _sufficient_, and on Webpack those come apart: a re-executed
entry reads its imports from the module cache, so it can seed a fresh store from a manager that has
not been replaced yet. A framework app survives this — something is subscribed, so the catalog
arriving a moment later repaints it. A vanilla app's only repaint is re-running the entry, which
repeats the same stale re-seed. Result: `""` for every key the incoming catalog was about to supply,
permanently.

`hmrInjectionCode` now receives `hasClientReactivity`, and `rspackFacet` requires it alongside
`entryReexecutionSafe`. A non-reactive entry declines, the update bubbles, and the page reloads —
slower than a hot update and correct, which is exactly the trade `viteFacet` already makes for
frameworks whose mount is not replayable. Vite ignores the argument: re-importing an entry there
re-fetches the whole chain, so re-execution is always sufficient.

**This is the same change that was written and reverted one iteration earlier**, when it was inert:
`react.ts` is the only preset declaring `clientReactivityImports`, and detection guessed React for
everything, so "has reactivity" was true for every project including ones with no components. L-034
removed the guess and the signal became real. Recorded because the ordering was not obvious in
advance — the fix looked wrong until an unrelated-seeming defect was cleared out from under it.

**A measurement lesson, again.** An ad-hoc probe reported this still failing: `reloaded=true` but the
heading blank across three successive edits, with `hasKey=true` on the store. A single edit driven
with an explicit `page.reload({ waitUntil: "load" })` rendered correctly. The probe was evaluating
into a document that was mid-reload — reload-based flows cannot be measured with a fixed `sleep`, and
the contract harness's `textEventually` polling is the instrument that can. Both `hmr` and
`hmr-stress` pass on `rsbuild-spa` and are claimed again.

**Still not `memory`.** Twenty sequential edits are now twenty reloads, and a reload resets the settle
beacon to the value it already had — the exact shape `waitForSettled` cannot confirm (L-029). It would
also measure nothing, since a reload resets the heap. Inferred from L-029's measured mechanism rather
than re-measured.

**A wrong turn, recorded.** `hmr` and `hmr-stress` were briefly left unclaimed here on the theory that
reload-per-edit was too expensive for the suite to sustain — the full run kept timing out on
`rsbuild-react`. That reasoning was wrong twice over: the timeouts were a port race (L-036), not cost,
and they were blamed first on machine load and then on capacity before either was checked. Both
capabilities are claimed.

**L-030 is now closed**: framework apps hot-update (L-032), vanilla apps reload correctly (this
entry).

### L-036 — two Rsbuild projects raced for one port, and every symptom looked like something else

|                             |                        |
| :-------------------------- | :--------------------- |
| **Status**                  | **Fixed**              |
| **Bucket**                  | N/A — a harness defect |
| **Facet contract changed?** | No                     |

Introduced by adding `examples/rsbuild-react`, and it made the contract suite unreliable for several
iterations while being misdiagnosed twice.

**The defect.** `createLabDevServer` defaults to `port: 0`, and `RsbuildDevServerDriver` turned that
into `undefined`. Vite reads `0` as "give me an ephemeral port", which can never collide. Rsbuild does
not — it would serve on literal port `0` — so passing `undefined` let _every_ Rsbuild project start
from Rsbuild's default of 3000 and auto-increment from there. With one Rsbuild example that was
invisible. With two on different workers it is a race, and the loser dies with:

```
Error: listen EADDRINUSE: address already in use ::1:3001
```

while its contract waits out the full 45s timeout.

**Why it took three attempts to see.** The symptom is a timeout on an _unrelated-looking_ contract,
and it moves between runs. It was blamed on:

1. **Machine load** — plausible, and partly true: `ps` showed VLC and Transmission running. Closing
   them did not fix it.
2. **Suite capacity** — "two Rspack dev servers doing reload-per-edit starve each other", which even
   led to `hmr`/`hmr-stress` being unclaimed on `rsbuild-spa` as a supposed cost of L-035.
3. **The actual cause**, visible only in the `Unhandled Errors` section printed _after_ the failure
   list — where an `EADDRINUSE` from a different worker had been sitting the whole time.

**The fix.** The driver asks the OS for a free port (bind `:0`, read it, close) and passes that
explicitly, with `strictPort` left off so Rsbuild can increment if the port is taken in the window
between close and listen.

**Two lessons.** A timeout is a symptom with many causes, and the harness prints the cause somewhere
other than where it prints the failure — read the whole output, not the failure list. And a
capability was un-claimed on the strength of a misdiagnosis: the "cost" being measured was a bug, not
a cost.

## Phase 6 — proposal 030: the red gate, and a hypothesis that had been open since 027

Both entries below came out of one question — why `[Memory Leak] react-basic` fails on a full-suite
run — and they are separate defects that had been producing one symptom between them. The method is
the only reason they came apart: a probe that counted entry re-executions per edit, run before
anything was changed, and again after each change.

### L-037 — a sibling stylesheet matched a component's boundary, and was repointed onto it

|                             |                                                                                         |
| :-------------------------- | :-------------------------------------------------------------------------------------- |
| **Status**                  | **Fixed** — and it confirms 027 §2.4's hypothesis, open since then                      |
| **Bucket**                  | **2 — relocate it**: applying stays synchronous, announcing moves off the caller's turn |
| **Facet contract changed?** | No                                                                                      |
| **Affects**                 | Vite only. `hmr/vite.ts` is that host's module-graph repair                             |

027 §2.4 named a hypothesis and refused to fix it as though it were a finding: `hooks/hmr.ts` matched
modules to boundaries with loose `endsWith` comparisons, and _"if that ever repoints a module away
from the file it belongs to, the next edit to that file yields `modules: []`, the hook returns it
unchanged, and Vite sends nothing."_ L-023 instrumented it, ran ten full-suite reproductions, and came
back with **zero** evidence either way. 028 §6.3 carried it forward as still unresolved.

It reproduces on `react-basic` in about one edit in ten, and the trace names it outright:

```
repoint "…/src/App.css"  …/src/App.css → …/src/App.tsx  (boundary=src/App.tsx:App, fileId=src/App.tsx)
```

**The mechanism.** The fallback scan compares with extensions stripped, because a normalized boundary
id arrives without one (L-026). `src/App.css` and `src/App.tsx` both strip to `src/App`, so the
stylesheet matched the component's boundary, had `mod.file` rewritten onto `App.tsx`, was moved
between entries in Vite's `fileToModulesMap`, and went into the returned update list as if it were the
component. The `enter … modules=0` that follows in the trace is exactly the shape 027 predicted.

**Why L-023's ten runs found nothing.** It looked for the symptom 027 named — a later edit yielding
`modules: []` and no update at all — and the observable consequence is different and much quieter:
`main.tsx` self-accepts, so the entry re-executes, `bootstrap()` runs again, and `createRoot()` mounts
a second root over the first. The text still arrives. Nothing fails until two roots and twenty rapid
edits are in the same run. **A hypothesis stated in terms of its expected symptom cost three
proposals; the trace that names the cause cost one probe.**

**The fix.** An extension-blind comparison now requires the _candidate_ to be a file Zintl would
extract from at all, asked through `classifyFile` rather than a second list so the two cannot drift.
Ids with no extension stay eligible — they are what those comparisons were written for. A stylesheet
is not a boundary's source under any reading, so nothing legitimate is lost.

**Measured**, sixty edits per configuration on `react-basic`, three runs of twenty:

| Configuration     | Entry re-executions | Double mounts |
| :---------------- | :------------------ | :------------ |
| Before            | 6 / 60              | 6 / 60        |
| After             | 3 / 60              | 3 / 60        |
| After, with L-038 | —                   | 1 / 60        |

Halved, not closed, and the residue is L-038's. Re-execution and double-mount were **perfectly
correlated** in every run, which is what made the two entries separable at all.

Guarded by a unit test in `hmr_integration.test.ts` that fails without the change: it asserts a
sibling `App.css` keeps its own `mod.file` and stays out of the update list.

### L-038 — React's entry is not safe to re-execute, and now nothing stops it saying so

|                             |                                                        |
| :-------------------------- | :----------------------------------------------------- |
| **Status**                  | **Fixed** — closes proposal 024 §1.3's last open case  |
| **Bucket**                  | **1 — declare it**                                     |
| **Facet contract changed?** | No — a new `reactRuntimeFacet` uses the existing field |
| **Unblocked by**            | L-034                                                  |

024 §1.3 left this in terms that turned out to be exactly right, and unactionable for two reasons at
once:

> **The React `createRoot` case remains latent**: marking React unsafe reaches every framework-less
> project, because `FALLBACK_FRAMEWORK` is `"react"`, and it regressed `vanilla-spa-basic`. The fix is
> one facet field away once there is a reproduction to justify it.

**Both blockers cleared independently, and nobody had connected them.** L-034 deleted the fallback, so
the claim now reaches React and nothing else. And the probe above is the reproduction — one edit in
ten, every one of them a double mount.

`reactRuntimeFacet` declares `entryReexecutionSafe: false`, mirroring `svelteRuntimeFacet` exactly.
Only Svelte had claimed it before, which is why the field looked like a Svelte quirk rather than the
general question it is.

**One thing worth stating precisely, because the field's name suggests otherwise.** On Vite this does
not prevent re-execution. `import.meta.hot.accept(cb)` executes the new module _first_ and calls `cb`
after, so the entry still re-runs and `createRoot` is still called twice — `invalidate()` then reloads
the page and clears the second root. The declaration converts a permanent two-root page into a reload.
That is the same trade Svelte has been making since 024, and the naming is inherited rather than new.

**The cost on Rspack was measured rather than assumed, and it is zero.** The concern was real: the
Rspack facet gates acceptance on this flag, so declaring React unsafe removes `webpackHot.accept()`
from `rsbuild-react`'s entry entirely (visible in its dev-transform snapshot). Since `rsbuild-react`'s
hot updates are 029's headline result, that looked like trading a Vite defect for an Rspack
regression. Driven by hand against a real `rsbuild dev`, four consecutive edits, the way 029 §4
established:

| Configuration               | Heading updated | Page reloaded | Double mounts |
| :-------------------------- | :-------------- | :------------ | :------------ |
| Baseline                    | 4 / 4           | none          | 0             |
| With `entryReexecutionSafe` | 4 / 4           | none          | 0             |

Identical. The entry's acceptance was never what carried component updates on that host — React Refresh
and the self-accepting content modules are — so removing it costs nothing for the case that matters.
`__zintl_version` advanced 2 → 6 in both runs with the sentinel intact.

**A misattribution, recorded because it nearly changed the decision.** `rsbuild-react` timing out at
45s was blamed on this change across two runs, and the change was very nearly reverted for it. Running
the suite three times with _only_ L-037 applied showed the same timeouts. **The stash-and-rerun
discipline that L-013 records saved this one in both directions: it cleared the change, and it also
cleared the machine.**

### What these two entries did and did not settle

**Did.** `[Memory Leak] react-basic` — the failure that started this, and the one thing in proposal
030 §1 that made `vpr ci` red — **has not recurred in any of the thirteen full contract runs since
L-037 landed.** At the outset it failed one run in two. The mechanism it depended on is measured down
from six occurrences in sixty edits to one.

**Did not.** `vpr ci` green is still not demonstrated on this machine, and it was not before either.
`vpr verify` passes (800 unit tests, lint, knip, format, examples built). The full contract suite
reached 148/148 three times across eight runs with both entries applied, and otherwise failed a
recurring set that **neither entry touches**: `Performance HMR` latency budgets — failing on
`svelte-basic` and `vue-basic`, which resolve no React facet at all — `rsbuild-react` 45s timeouts,
and occasionally `Chaos Catalog`. Wiping `.tmp/runs` and `node_modules/.zintl` per 028 §3 did not
help; the run immediately after a wipe was the worst of the set, and the next was clean.

That is a pre-existing suite-reliability problem, surfaced rather than caused here, and it is
**027 §3.5's unfinished item** — _"re-measure the 4-worker failure rate so any regression is
attributable"_ — now overdue with two Rsbuild projects in the manifest rather than one. It wants its
own investigation, on a machine that has not just spent two hours running browser suites, and it
should not be folded into either entry above.

### L-039 — `hmr` on `rsbuild-react` is claimed and intermittent: an update loop, not a stall

|                             |                                                                                                     |
| :-------------------------- | :-------------------------------------------------------------------------------------------------- |
| **Status**                  | **Partly fixed** — the render loop is closed; the residual is diagnosed in [L-041](#l-041)          |
| **Bucket**                  | **2 — relocate it**: applying stays synchronous, announcing moves off the caller's turn             |
| **Facet contract changed?** | No                                                                                                  |
| **Blocks**                  | `hmr-stress`, `chaos` and `memory` on `rsbuild-react`, and any further capability that drives edits |

Found while doing proposal 030 §6 — attempting to claim the capabilities that looked earnable — and it
inverts that section's question. The gap on this project is not that more capabilities are wanted; it
is that **the one already claimed does not hold reliably**.

**Measured, in isolation, with no contention and only sixteen tests in the run:**

| Contract                          | Result                                        |
| :-------------------------------- | :-------------------------------------------- |
| `[Locale Storm] rsbuild-react`    | 3 / 3 passed → `locale-switch-stress` claimed |
| `[HMR Propagation] rsbuild-react` | **1 of 3 runs failed**, 45s timeout           |

`hmr-hammer`, `chaos-catalog` and `memory-leak` all exhausted the same 45s budget when tried.

**And confirmed at full-suite scale, which is the sharper evidence.** After clearing the stale
`node_modules/.zintl` that 028 §3 warns about, three consecutive full runs of all 149 cases gave:

| Run | Result                                        |
| :-- | :-------------------------------------------- |
| 1   | `[Syntax Error Recovery] rsbuild-react` — 45s |
| 2   | 149 / 149 green                               |
| 3   | `[HMR Propagation] rsbuild-react` — 45s       |

**Every failure in the suite is now one `rsbuild-react` HMR contract, and nothing else fails at all.**
Both failing contracts require `hmr`, and both belong to the capability already claimed.

**The obvious explanation is wrong, which is the finding.** 029 §4.1 attributed `memory` being
unclaimable to throughput — every edit on this host costs two compilations, because Zintl's own
catalog write is necessarily a declared dependency of the generated modules. That reasoning is sound
and it is not what is happening here:

- A latency probe measured `react-basic` at **173 ms mean per edit** (147, 279, 148, 149, 140).
- The same probe on `rsbuild-react` could not complete **one** edit inside 45s — nor two, nor five.
- A **zero-edit** probe (navigate and settle only, three projects) finished in **3 s total**, so
  server startup is about a second and is not the consumer.

One edit that cannot finish in forty-five seconds is not a slow edit. Something in the path either
stalls or never signals, and the intermittency of `[HMR Propagation]` is the same shape at a lower
rate.

**It also revises what L-038 recorded, and the revision is worth reading as a method note.** That
entry saw `rsbuild-react` timeouts recurring across full-suite runs, cleared them as not caused by the
change under test — which was correct, and was the question it needed to answer — and then reached for
machine load to explain what remained. Two things were wrong with that. The `Performance HMR` and
`Chaos Catalog` failures that accompanied them **were** load, and stopped once the machine had settled
and stale state was cleared; the `rsbuild-react` ones did not, and reproduce with four workers idle.
Attributing a mixed set of symptoms to a single cause is how the real one stays hidden — the same
mistake L-036 records, where a port race sat behind "machine load" and then "suite capacity" for three
attempts. L-038's conclusion stands; its aside about the machine does not, and this entry supersedes
it.

**Diagnosed.** It is not a stall, and the shape of the evidence is why it looked like one.

**It is an unbounded React update loop.** A probe that reports instead of dying at the cap caught it
on the first run: the edit is written at +700 ms, and the page then emits **696 errors in 12 seconds**
— about one every 17 ms — with **no navigation at all**. The renderer is pinned, so every Playwright
read blocks: an unbounded `textContent()` waits its full 30 s default, `page.evaluate` hangs outright
rather than rejecting, and `describeStall()` — the diagnostic built for exactly this — cannot run
because it needs the page. **A wedged renderer looks identical to a silent stall from outside.**

The stack names the mechanism:

```
Error: Maximum update depth exceeded
    at forceStoreRerender          (react)
    at I18nStore.notify            (…/manager/none/entry:b_src_main_tsx_bootstrap)
    at I18nStore.addCatalogs       (…)
```

preceded once by React's own diagnosis: `Cannot update a component (App) while rendering a different
component (App)`.

**The defect is an impure read.** `getActiveInstance()` is not a getter — in a browser it compares
`document.documentElement.lang` against the store's locale and fires `setLocale()` when they disagree.
Its own comment acknowledges this (_"`getActiveInstance` fires `setLocale` from a getter"_). The
loaders `setLocale` iterates can resolve **synchronously**, because the manager inlines the anchor's
own locale — the synchronous boost. So the chain `setLocale → addCatalogs → notify →
forceStoreRerender` completes _inside_ whatever called it.

And React calls into it during render. `pipeline/resolve.ts` injects
`useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)`, and `getStoreVersion()` reaches
`getActiveInstance()` — so React's snapshot, which must be pure, mutates the store. Every translated
string in the component body reaches it the same way.

**Pre-existing, and not caused by L-038.** Confirmed by flipping `entryReexecutionSafe` back to `true`
and rebuilding: 661 throws, the same stall, the same read timeout. That was the first thing checked,
because L-038 had changed acceptance on this host one section earlier.

**The cause was one level deeper than the first diagnosis said, and the first diagnosis was wrong
about which impurity mattered.** An earlier pass blamed `getActiveInstance()`, which is genuinely
impure — it fires `setLocale` to reconcile `<html lang>` — and deferring that changed nothing, because
in a browser the branch is unreachable: `__zintl_current_instance` is set at module init and returns
two checks earlier. A second capture, with the stack no longer truncated below `addCatalogs`, named
the real path:

```
at App                          ← React render
at _t                           ← a translation lookup, during render
at I18nStore.loadLazyBoundary
at processResult                ← the loader resolved synchronously
at I18nStore.addCatalogs
at I18nStore.notify
at forceStoreRerender           ← React
```

`_t` resolves a missing key by triggering the boundary's load and re-reading it in the same
expression — deliberately, and the comment there says why: after a hot update the new loader's catalog
is available on that very tick, because the manager inlines the anchor's locale. So the load completes
synchronously, `addCatalogs` announces, and the announcement lands **inside the render that asked**.
Each re-render runs `_t` again and announces again.

**Fixed by splitting applying from announcing.** `addCatalogs` stays synchronous — `_t`'s re-read
depends on it. `notify()` now defers to a microtask and coalesces, so a burst announces once, after
the caller's turn. `version` moves inside that microtask rather than beside the data, which is the
subtle half: `version` is React's snapshot, and a snapshot that moves _during_ render makes React
re-render to reconcile it — bumping it synchronously would re-arm the same loop without the warning
that names it. Deferring both together preserves what `useSyncExternalStore` requires, that the
snapshot has already moved when the subscriber fires.

**Measured:** ~700 console errors per run on `rsbuild-react` → **0**, across every run since. Three
unit tests asserted synchronous notification and now await a microtask first; that is the contract
changing, not a test convenience, and their comments say so. `vpr verify` green at 800 tests, twelve
runtime-embedded snapshots regenerated, full contract suite 149/149 on a clean run.

**What the fix did not do, stated plainly: it did not make `[HMR Propagation] rsbuild-react` reliable.**
The failure rate is unchanged. So the loop and the timeout co-occurred rather than one causing the
other, and the timeout is a second defect wearing the first one's symptoms.

**What is now known about that second defect**, which is more than before and still not a diagnosis:

- It is **not** per-edit throughput, startup, contention with the machine, or L-038's declaration —
  each ruled out by measurement, the last by flipping the flag and re-running (3/3 unchanged).
- The server **does** push updates: `packets=["update","update"]` on a failing run, with the edit
  confirmed on disk.
- It is **specific to React on Rspack**. The same probe applies in 222 ms on `react-basic` (Vite +
  React) and 238 ms on `rsbuild-spa` (Rspack + vanilla).
- And it is **not deterministic in the product but in the arrangement**: `rsbuild-spa` applied in
  238 ms when probed alone and failed — with an empty `h1`, the L-030 signature — when probed in the
  same process as `rsbuild-react`. Two Rsbuild dev servers in one worker interfere with each other in
  a way one does not.

**The two-servers hypothesis was tested and is refuted.** It was the obvious reading of that last
point, and it is the one thing this entry predicted: cap the pool at **one Rspack dev server per
worker**, retiring any other before starting one, so no worker ever has two Rspack compilers watching
two trees. Implemented in `dev-server.ts` — the plumbing verified rather than assumed (`opts.driver`
reaches the pool, the pool keys on the manifest name) and the retirement visibly happening, since wall
clock rose from ~100 s to ~130–150 s on the restarts it forces.

**It changed nothing.** Two full runs, two failures, the same two contracts as before
(`[Syntax Error Recovery]` then `[HMR Propagation]`, both `rsbuild-react`), against a baseline of
three failures in the four preceding runs. Reverted: a 25–50% wall-clock cost for no measured benefit
is not a trade, and pooling's own comment is right that a shared server per project is load-bearing.

So the paired-probe observation stands as an observation and falls as an explanation. Two Rspack dev
servers in one worker are **not** why `rsbuild-react` fails intermittently, and the probe result that
suggested they were is more likely to have been the probe measuring itself — raw writes into a
memoized worker copy it never restored, which is a defect this entry already had to correct for once.

**What that leaves.** The failure is specific to React on Rspack; the server pushes its updates; the
edit reaches disk; the page shows no error and never converges. Every environmental explanation
offered so far — throughput, startup, machine load, the entry declaration, and now server isolation —
has been measured and rejected. The next honest step is not another hypothesis but an instrument that
survives the thing it measures: the harness cannot attach a diagnosis to a 45 s vitest kill, so the
first work here is making the contract fail _before_ the cap with the page state captured, rather than
being killed with it unread. Everything since has been guesswork wearing measurement's clothes, and
this entry has now recorded four rejected guesses to one real fix.

**A separate cleanup this surfaced and did not do:** `getActiveInstance()` still mutates, firing
`setLocale` from what reads as a getter. It is unreachable in a browser today — `__zintl_current_instance`
returns first — so it is latent rather than live, and `store-client.ts`'s `clientLocaleSync` already
owns that reconciliation properly for every project except `vinext-basic`, whose `nextjs-runtime`
supersedes `client-spa`. Worth removing with a Next-side replacement, not inside a defect fix.

**What is still not established:** why the reconciliation branch fires at all here, given the probe
navigates to `/` with no locale in the path. It requires `targetLocale !== inst.locale`, so a hot
update on this host is leaving a store instance whose locale disagrees with the document — which is
L-030's "a new store per entry re-execution" from the other side. Worth confirming before the fix
above is written, because it decides whether the reconciliation is load-bearing here or merely
reachable.

**Why this was not caught earlier.** `hmr` was claimed on the strength of contracts that passed, and
they do pass — most of the time. Nothing in the suite distinguishes "passes" from "passes two runs in
three", and a capability list records only the former. That is a gap in how capabilities are earned,
not just in this host: **the discipline is "claim it once its contract passes", and it has no notion
of passing _reliably_.**

**And a diagnostic gap worth fixing on its own — now fixed, see [L-040](#l-040).** Every failure shape
this suite was built to explain attaches page state; this one could not, because the page is the thing
that is broken and the harness was killed before it could say so. Contracts now fail on their own
budget with the diagnosis captured, and the first `rsbuild-react` timeout to land under the new
instrument already said something five investigations had not: the server pushed its updates, the page
answers nothing, and there are **no console errors** — so whatever wedges it now is not the render
loop this entry fixed.

### L-040 — the harness could not explain its own worst failures

|                             |                                                               |
| :-------------------------- | :------------------------------------------------------------ |
| **Status**                  | **Fixed**                                                     |
| **Bucket**                  | N/A — a harness defect, and the one that hid several others   |
| **Facet contract changed?** | No                                                            |
| **Unblocks**                | every future occurrence of [L-039](#l-039) and its neighbours |

Not a product defect. It is the reason four of this ledger's investigations cost what they did, and it
was in plain sight the whole time.

**The shape.** `executeContract` collects every diagnostic this harness has — packet counts, the
settle beacon, the delivery ledger, the compiler ledger, the HMR trace, the body outline — in the
`catch` around the contract body. When vitest hits `testTimeout` it kills the test where it stands, so
that `catch` never runs. What reached the report was `Error: Test timed out in 45000ms` and nothing
else. **Precisely the failures that most needed explaining were the ones that arrived unexplained**,
and every one of them was a timeout.

Two mechanisms had to be fixed, because either alone leaves the other in place.

**1. The contract now fails before the cap does.** `withContractBudget` races the body against a
deadline of `testTimeout - 15s`, so a contract that runs long fails _here_, with diagnosis, instead of
being killed. A **deadline** rather than a duration, and that distinction was measured rather than
reasoned: a first attempt counted from the moment the body started, and under a loaded four-worker run
`createLab` — which starts a dev server and launches a browser — had already spent long enough that
the budget expired _after_ the cap it was meant to precede. Two contracts still died at 45 000 ms with
no diagnosis. Anchoring to the test's own start keeps the reserve intact however slow the setup was,
and the message reports what setup consumed.

**2. The diagnosis no longer hangs.** Every page read in `describeStall` was already wrapped in a
`try/catch` with a message naming what could not be read, and **none of them ever fired**, because an
unresponsive renderer does not reject — it never answers, and Playwright waits out a default longer
than the whole test. Each read is now raced against 1.5s, which is what lets those `catch` blocks do
the job they were written for. Teardown is bounded too, at 4s: a diagnosis printed and then swallowed
by a hang in cleanup is no better than never printing it.

**The reserve was sized against the measured worst case, and the first size was wrong.** At 12s the
budget fired correctly and vitest then killed the test _during teardown_, discarding the diagnosis it
had just produced — the same silent failure one step further along. The tail is now bounded at 10s
(four reads at 1.5s, plus 4s of teardown) inside a 15s reserve.

**No contract was squeezed.** The heaviest ones measured 3.2–5.6s healthy (`memory-leak` 3.3–5.6s,
`locale-storm` 1.2–1.9s); the 25s figure this ledger quotes elsewhere for `memory-leak` was a _failing_
run waiting out its own timeouts. A 30s budget leaves roughly a five-fold margin.

**Verified on the failures it was built for.** Across three full runs: two green, and one with three
failures at 39.3s, 40.0s and 32.0s — all inside the cap, **all three carrying a page diagnosis**. The
`rsbuild-react` timeouts that five investigations could not see now report `hmr packets: {"update":2}`
with the page unreadable and no console errors, which is a materially better starting point than
`Test timed out`. `[Syntax Error Recovery]` turned out to be sitting on an swc `Module build failed`
the report had never shown. And `[Memory Leak] react-basic` — the failure that opened proposal 030 §1
and had to be hunted by rerunning the suite — now describes itself on first occurrence.

**The lesson, and it generalises past this suite.** A diagnostic that runs only on the failure path is
untested by definition; this one had a path it could never reach, and no amount of care in _writing_
diagnostics substitutes for checking that the worst failure can actually print them. The tell was
available from the first occurrence: every unexplained failure was a timeout, and every explained one
was an assertion.

### L-041 — proposal 029's hot-update tap never registers, and the residual is what fills the gap

|                             |                                                                            |
| :-------------------------- | :------------------------------------------------------------------------- |
| **Status**                  | **Diagnosed, unfixed** — cause established by measurement, fix not written |
| **Bucket**                  | **2 — relocate it**: the seam exists and nothing reaches it                |
| **Facet contract changed?** | No                                                                         |
| **Closes**                  | [L-039](#l-039)'s residual — the intermittency that survived the loop fix  |

The [L-040](#l-040) instrument found this on its first reproduction, which is the strongest argument
for having built it.

**What the failure says now**, where before it said `Error: Test timed out in 45000ms`:

```
hmr packets: {"update":2}
page liveness: open at http://localhost:53129/ · 28245 console message(s) captured
last console lines:
    [warning] [Zintl] Missing key "HMR works!" in boundary "b_src_App_tsx_default". …
console errors: none
page state: unreadable  ← the page itself is the failure
```

**A warning-level loop**, which is exactly why every previous look reported "no console errors" and
learned nothing: 28 245 messages here, 226 257 in another reproduction. The renderer is pinned
emitting them, so every page read times out — the page is _open_, not navigating, not closed, and
simply never answers.

**One inference corrected on the way.** `b_src_App_tsx_default` looked like a boundary-identity
mismatch against the `b_src_App_tsx_App` seen in other ledgers. It is not: `rsbuild-react` writes
`export default function App`, so `_default` is its canonical id — the `_App` sighting was
`react-basic`, a different app with a different export shape. The lookup asks the right boundary. The
key simply is not in it.

**Which is the whole defect, established on disk rather than inferred.** After a failing edit the
worker copy's `src/i18n/translations.json` **does not contain the new string**; after a passing edit it
does. Measured three times, one failure and two passes. So this was never a delivery problem —
**Zintl did not produce the catalog at all**, and the runtime is looping on a key that does not exist
anywhere.

**Then the reason, and it is larger than this contract.** `registerRspackHotUpdate` — the `watchRun`
tap that proposal 029 built, carrying `Watching.startTime` as the per-event sequence and
`compiler.inputFileSystem` as the scoped read — **is never called.** A trace entry pushed
unconditionally at registration produced **zero** entries: in the harness, across both Rsbuild
projects, and under a real `pnpm dev` on `examples/rsbuild-react`. It is not a harness artifact.

The context wiring was verified before concluding that, because it would have been the easy way to be
wrong: the harness resolves exactly one context per project, `rootDir` matching the lab root,
`isDev=true`. It reads the right object. The object has nothing in it.

**So how does Rsbuild hot-update at all?** Through the ordinary path: Rspack rebuilds the changed
module, unplugin calls Zintl's `transform`, extraction runs there, `flush()` writes the catalog, and
`dependencyInvalidation` rebuilds the generated modules that declare it. That path has no ordering
contract — none of `invalidateForUpdate`'s custody, the delivery bus's sequencing, or ZDB §7a's two
guarantees is in play, because the hook that supplies them never runs.

**The remaining step is a hypothesis, marked as one:** without that ordering, whether the regenerated
catalog reaches the browser together with the component's new code is a race, and losing it leaves a
key missing _permanently_, because nothing re-runs. That fits every observation — intermittent, React-
specific (a component re-renders and re-asks; `rsbuild-spa` reloads instead and re-reads from scratch),
and silent apart from the warning. It is not yet proven, and proving it means instrumenting the
transform-and-flush ordering rather than reasoning about it.

**What this means for proposal 029.** Its facet seam, its applier split and its declared-dependency
mechanism all stand — `dependencyInvalidation` is doing real work and is why anything updates. What
does not stand is the claim that Rspack's Tier-2 guarantees are being used: they were established as
_available_ (§1) and wired (§2), and the wiring does not fire. Whether `rspack(compiler)` is the wrong
escape hatch under Rsbuild's programmatic and CLI dev paths, or unplugin's Rsbuild adapter forwards it
only for builds, is the first thing to establish next — and it is a question about one hook, which is
a much smaller problem than the one this entry started with.

#### Why `rspack(compiler)` never fires — answered, from unplugin's source

[L-041](#l-041) named this as the next thing to establish. It is not a subtlety; it is a one-line
guard, and reading the shipped source rather than the documentation (026 §6.2) answers it outright.

`unplugin@3.3.0`, `dist/index.mjs`, inside `applyRspackPlugins`:

```js
if (meta.framework === "rspack") meta.rspack.compiler = compiler;
…
if (meta.framework === "rspack" && plugin.rspack) plugin.rspack(compiler);
```

and the Rsbuild target, thirty lines further down:

```js
function getRsbuildPlugin(factory) {
  const meta = { framework: "rsbuild", … };            // ← not "rspack"
  …toRsbuildPlugin(rawPlugin, meta)
}
function toRsbuildPlugin(rawPlugin, meta) {
  api.modifyRspackConfig((config) => {
    config.plugins.push(getRspackPluginFromRaw([rawPlugin], meta));   // ← same meta, unchanged
  });
}
```

**The Rsbuild adapter really does push the raw plugin into `modifyRspackConfig` — and it carries its
own `meta` along with it.** So by the time `applyRspackPlugins` runs against a real Rspack compiler,
`meta.framework` still reads `"rsbuild"`, both guards are false, and the escape hatch is skipped.
`plugin.rspack` is reachable **only** through `unplugin.rspack`, the raw-Rspack target — and `zintljs`
ships no such entry point (`.`, `./vite`, `./rsbuild`, `./macro`, `./facets`). The hook is therefore
dead code for every published entry, which is why zero registrations appear in the harness _and_ under
a real `pnpm dev`.

**The comment in `plugin.ts` states the premise correctly and draws the wrong conclusion from it:**

> _"The Rspack layer, which unplugin calls under raw Rspack **and** under Rsbuild — `toRsbuildPlugin`
> pushes this same raw plugin into `modifyRspackConfig`, so one registration covers both."_

The plugin is pushed. The `rspack` hook on it is not called. 028 §1.2 records the adjacent fact that
unplugin reports `framework: "rspack"` for both hosts — true of the **build context** inside the
loaders, which is what `nativeHostView` reads, and not of the **plugin meta** this guard tests. Two
different `framework` fields, one name, and the whole of proposal 029's Tier-2 wiring resting on the
distinction.

**What is wired under Rsbuild regardless of framework**, from the same function, and it is why
everything else works: the transform and load loaders, `buildStart`/`buildEnd` (via `hooks.make` and
`hooks.emit`) — and, notably, **`watchChange`**, which unplugin calls per changed file from
`hooks.make`.

**Which names the fix, and there are two shapes.** `watchChange` is the hook 029 §2 explicitly
rejected — it fires after module building has started, and hands one file at a time rather than the
batch that makes a single sequence per cycle correct. Both objections still hold, so the better fix is
to register the tap from the layer that does run: the plugin already has an `rsbuild: {}` block, used
for dev detection (L-020) and `api.modifyHTML` (L-019), and `api.modifyRspackConfig` there can push a
plugin whose `apply(compiler)` calls `registerRspackHotUpdate` — the real `watchRun`, with
`Watching.startTime` and the changed batch intact, exactly as 029 designed. A `zintljs/rspack` entry
point for raw Rspack is a separate, additive question.

**Not written here.** This entry answers the question it was asked; the fix is a runtime-affecting
change to the host with a defect ([L-041](#l-041)) still open behind it, and it deserves its own
measurement rather than being appended to a diagnosis.

### L-042 — the tap is wired, and turning it on stranded a flush

|                             |                                                                       |
| :-------------------------- | :-------------------------------------------------------------------- |
| **Status**                  | **Wiring fixed; a defect behind it is open**                          |
| **Bucket**                  | **2 — relocate it** (the wiring); the flush defect is not yet triaged |
| **Facet contract changed?** | No                                                                    |
| **Follows**                 | [L-041](#l-041)                                                       |

**The wiring.** `registerRspackHotUpdate` is now registered from the plugin's `rsbuild` block, through
`api.modifyRspackConfig` — pushing a bare `{ apply(compiler) }`, which is what unplugin's own adapter
does one line away. Registration is idempotent per compiler (a `WeakSet`), so the `rspack` escape hatch
stays correct for a future `zintljs/rspack` without risking a double tap, and the comment there now
says what it is: raw Rspack only.

**It works, and the trace shows proposal 029's mechanism running for the first time:**

```
watch (registration) → watchRun tap registered
watch (none)         → no compiler yet          ← the first cycle, exactly as documented
watch (batch)        → 1 modified
enter  src/App.tsx   seq=…
return src/App.tsx
watch (batch)        → 1 modified
skip-writing …/translations.json                ← isWritingFile holding on this host too
```

`invalidated=0` on `return` is correct rather than alarming: `RspackUpdateApplier` reaches zero modules
directly by design (029 §3).

**And turning it on made the suite redder, which has to be said plainly.** `[Syntax Error Recovery]`
on **`rsbuild-spa`** now fails in roughly two runs of three; it passed reliably before, for the worst
possible reason — the mechanism under test was never running. Three full runs after the change: two
with `rsbuild-spa` syntax-recovery failing, one with the older `rsbuild-react` pair. Both Rsbuild
projects can now fail where previously only one did.

**What the new failure is**, read from the diagnosis [L-040](#l-040) makes available:

```
compiler ledger: flush #2 → superseded (joined the in-flight flush; dirt retained for the next)
                 flush #9 → superseded (joined the in-flight flush; dirt retained for the next)
[warning] [Zintl] Missing key "Recovered!" in boundary "b_src_main_render"
```

The retained dirt is never written, so the recovery edit's key never reaches a catalog. `runFlush`
states its own guarantee precisely, and states the assumption it rests on:

> _"the next trigger flushes it — the debounce timer is already scheduled by the `transform` that
> dirtied it."_

**On Vite that holds, because `transform` is what dirties.** With this tap live on Rspack, `watchRun`
dirties _before_ module building starts — that earliness is the whole reason 029 chose it over
`watchChange` — so the dirt exists before any `transform` has run. When the build then fails, which is
exactly what `syntax-recovery` arranges, `transform` never completes and **no debounce is ever
scheduled**. The dirt waits for a trigger that cannot come.

That last step is inference from the code and the ledger rather than a separate measurement, and it is
marked as such. What is measured: the flush is superseded, the dirt is retained, the key never appears,
and the failure arrived the moment the tap started firing.

**Fix-forward was attempted twice, and neither attempt is defensible.**

The defect looked like a missing trigger: `flush()` clears `autoFlushTimeout` on the way in, so a
mid-flight caller's retained dirt can be left with nothing scheduled to take it. Two shapes were
built and measured.

| Attempt                                                     | `syntax-recovery` on `rsbuild-spa` |
| :---------------------------------------------------------- | :--------------------------------- |
| Re-arm the debounce on the superseded path                  | 3 / 3 fail                         |
| Re-arm only after a _completed_ flush that left dirt behind | 4 / 4 fail                         |
| Neither (tap wired, compiler untouched)                     | first 1 / 3 fail, later **6 / 6**  |

Both were reverted. The reason they cannot be called "worse", though, is the third row: **the baseline
moved from 1-in-3 to deterministic with no code change between the batches.** Every comparison in that
table is therefore against a baseline that was drifting, which makes the two rejections unproven
rather than measured — the same trap L-036 and L-038 record, arrived at a third time.

**What is solid is the attribution.** With the wiring stashed and the compiler untouched,
`syntax-recovery` passes 3 / 3; with the wiring restored it fails 6 / 6, warm copies and cold alike.
Registering the tap deterministically breaks a contract that was reliably green.

**And that is the one genuinely good thing here: the defect is now deterministic.** Every previous
attempt in this area failed for want of a reproduction that fires every time; this one does, in
isolation, in about eighteen seconds. Whatever is wrong is now cheap to observe, which is precisely
the position L-039 spent five investigations trying to reach.

**Where the evidence points**, unproven and written down so the next attempt starts here rather than
at the beginning: the contract breaks the file, waits, then repairs _and_ renames in a single edit.
With the tap live, Zintl now processes the broken cycle, and the delivery ledger from a failing run
ends `runtime/catalog en/b_src_main_render #2 → superseded (already loaded)` — the runtime declining to
re-fetch a catalog it already holds, which `loadLazyBoundary` documents as a known gap: _"a catalog
that is present and stale, with no load outstanding, cannot be re-fetched through this path."_ On Vite
that never bites, because Vite pushes a fresh content module rather than waiting for the runtime to
pull. So the likely shape is a broken parse leaving the boundary holding a catalog the recovery edit
can no longer replace — which is a question about what `invalidateForUpdate` leaves behind when
extraction throws, not about flush scheduling, and the two attempts above were aimed at the wrong
layer.

**Decided: the wiring is reverted.** It works and it deterministically breaks a contract that was
reliably green, and a known-red suite is worse than documented dead code. Restored to green — 3/3 on
`syntax-recovery` in isolation, 149/149 on one full run and the older `rsbuild-react` failure on the
other.

Two things were deliberately **kept** out of the revert, because neither is wiring:

- **The comment on the `rspack` hook**, which now says what is true — the hook does not run for any
  entry point `zintljs` ships, 029's Tier-2 mechanism is dead code on the host it was written for, and
  Rsbuild hot-updates through the ordinary transform-and-flush path. The comment it replaces asserted
  the opposite, and reasoned from "the plugin is pushed" to "the hook is called". Reverting the code
  and restoring that sentence would put the misleading claim back after proving it false.
- **The registration trace entry**, which is what makes an empty trace mean something. Before it, "the
  tap never ran" and "the tap ran and declined" were indistinguishable, and the first was true for a
  long time without anyone noticing.

**A mistake worth recording, because it nearly shipped.** The first revert attempt left `plugin.ts`
syntactically broken; `vpr build` failed, and the three `syntax-recovery` runs that followed reported
**PASS against a stale `dist`**. They were meaningless, and they looked exactly like success. The tell
was there and missed — a chained `&& echo built` that never printed. A test run is only evidence about
the code that was actually built, and this ledger now has two entries where a green result came from
something other than the change under test.

**What the next attempt should start from**, unchanged by the revert: the defect is deterministic with
the wiring applied, reproducible in isolation in about eighteen seconds, and the evidence points at
`invalidateForUpdate` leaving a boundary holding a catalog the recovery edit cannot replace — not at
flush scheduling, where both attempts above were aimed.

### L-043 — a file that could not be parsed was invalidated as though it had been read

|                             |                                                                               |
| :-------------------------- | :---------------------------------------------------------------------------- |
| **Status**                  | **Fixed** — and it does not close [L-042](#l-042), which is a separate defect |
| **Bucket**                  | **3 — delete the guess**                                                      |
| **Facet contract changed?** | No                                                                            |
| **Affects**                 | **Both hosts.** Latent on Vite, load-bearing on Rspack                        |

`invalidateFile` re-extracts a changed source file and, on failure, logged and **fell through**:

```ts
try {
  await this.transform(code, filePath, undefined, true);
} catch (e) {
  this.logger.error(`Failed to re-extract messages during invalidation: …`);
}

for (const bId of boundaries) {          // ← ran either way
  foundBoundaryIds.push(bId);
  this.messages.markDirty(bId);
}
…
delete this.catalog.getCache()[bId];      // ← cache dropped either way
this.boundaryRevisions.set(bId, +1);      // ← revision bumped either way
this.catalogGeneration++;                 // ← generation advanced either way
```

Every one of those is an assertion that new content had been read, made on the strength of content
that **could not be read at all**. The compiler then regenerated catalogs for those boundaries from
whatever the failed extraction left behind, and stamped them with a generation newer than the world
they described — and `catalogGeneration` is exactly what the runtime uses to discard a catalog that
arrives after a newer one. A parse failure could therefore mint an authoritative-looking catalog out
of state nobody had verified.

**The fix is to do nothing**, which is the whole of it: the file's messages are unchanged as far as
anything here can tell, so the previous state is the best available and the next parseable edit
re-extracts it properly. The failure is named on the bus rather than dropped (Axiom D2), so "left
alone because its source could not be read" is distinguishable from "invalidated". This is the
no-fallback rule applied one layer down — do not guess at content, make the gap visible.

**Why it went unnoticed.** A syntax error mid-keystroke is the most ordinary input a dev watcher sees,
and on Vite the damage is invisible: the next parseable edit re-extracts, and Vite pushes a fresh
content module for the whole chain rather than waiting for the runtime to pull. Nothing in the suite
could see the difference until the Rspack `watchRun` tap started feeding this function unparseable
files directly (L-041, L-042).

**Measured.** `vpr verify` green at 800 unit tests; contracts 149/149 on one full run, with the
pre-existing `memory-leak`/`rsbuild-react` pair on another. Against L-042's deterministic
reproduction — the tap temporarily re-applied purely to reproduce — `syntax-recovery` on
`rsbuild-spa` went from **6 failures in 6** to **3 in 4**, with the first pass that configuration had
produced at all.

**It is an improvement and not the cure, and the distinction matters.** The remaining failure carries
the same signature it always had:

```
runtime/catalog en/b_src_main_render #2 → superseded (already loaded)
heading: ""
```

That is `loadLazyBoundary` declining to refresh a boundary it already holds — the limitation its own
comment records (_"a catalog that is present and stale, with no load outstanding, cannot be re-fetched
through this path"_). The runtime is holding a manager whose catalog was inlined at build time and
refusing the one edit that would replace it. So L-042's remaining half lives in the runtime's **pull**
path, not in invalidation, and the wiring stays reverted until that is fixed.

### L-044 — a rebuilt manager's catalog was discarded; the fix was reverted for destabilising HMR

|                             |                                                                                 |
| :-------------------------- | :------------------------------------------------------------------------------ |
| **Status**                  | **Reverted** — the defect is real and confirmed; the fix regressed `hmr-hammer` |
| **Bucket**                  | **3 — delete the guess**                                                        |
| **Facet contract changed?** | No                                                                              |
| **Affects**                 | **Both hosts.** Latent on Vite, reachable on Rspack                             |

The exported `registerLoader` — the function every generated manager calls — refused to load when the
store already held a catalog for that boundary:

```ts
const target = instance.locale;
if (instance.catalogs[target]?.[boundaryId]) {
  return;
}
```

The guard is right for the initial load, where a catalog may already have arrived inline and
re-loading it is redundant. It was also swallowing **the one call that carries new content**: a manager
module's body only runs a second time because it was _rebuilt_, and it then calls this with a fresh
loader closing over a fresh catalog. The store kept the pre-edit catalog, `_t` missed every new key
against it, and — no source-locale fallback, by design — the heading rendered `""` permanently,
because nothing re-runs.

`loadLazyBoundary` cannot rescue it, and says so itself: _"a catalog that is present and stale, with no
load outstanding, cannot be re-fetched through this path."_ Nothing ever starts the load, so nothing
joins it.

**The fix is loader identity.** Only a rebuild can produce a different function for the same boundary,
so `previous !== loader` distinguishes a re-registration from a repeat. A repeat still short-circuits.

**Vite never needed it**, which is why it sat here: Vite re-imports the whole chain with a fresh `?t=`,
so the content module applies its own catalog through `addCatalogs` before anything asks the manager.

**Proven the only way it honestly could be.** Two unit tests: a re-registration with a new loader
replaces the catalog, and re-registering the _identical_ loader does not reload. Both fail against the
previous behaviour (`expected 'before' to be 'after'`) and pass after. 802 unit tests green.

**And it did not fix what it was reached for, which is the point worth recording.** It was written to
close L-042's residual — `syntax-recovery` on `rsbuild-spa` with the tap wired — and that contract
failed 3 runs in 4 both before and after. The diagnosis says why, and it is a third mechanism rather
than this one: `hmr packets: {"update":3,"full-reload":2}`. **The page reloads.** On a reloaded page
there is no previous loader, so this fix cannot apply; the browser is served whatever bundle existed
when the reload landed, and if the rebuild had not finished, that bundle predates the recovery. The
residual is a reload/rebuild race, not a pull-path refusal.

Three defects have now been separated out of one symptom: the render loop ([L-039](#l-039)), the
invalidation of an unparseable file ([L-043](#l-043)), and this. Each is fixed and each was real; none
of them is the reload race, which is what still holds the tap out of the tree.

**A note on the numbers, because they invite over-reading.** Full contract runs after this landed:
1, 2 and 3 failures, all of them the known intermittents (`rsbuild-react`'s HMR pair, `memory-leak` on
`react-basic`, `Performance HMR` on `vue-basic`). The comparable pre-fix band measured 0–2. That is
inside the drift this ledger has recorded twice, so it supports neither "improved" nor "regressed",
and the unit tests are the reason this change is defensible rather than the contract counts.

### L-045 — the reload race is not a product defect

|                             |                                                                                |
| :-------------------------- | :----------------------------------------------------------------------------- |
| **Status**                  | **Refuted** — no product-level race demonstrated; the failure is the harness's |
| **Bucket**                  | N/A — a hypothesis retired                                                     |
| **Facet contract changed?** | No                                                                             |
| **Changes**                 | [L-042](#l-042)'s remaining half, and where to look for it                     |

[L-044](#l-044) ended by naming a reload/rebuild race as what still held the tap out of the tree: the
failing contract reports `hmr packets: {"update":3,"full-reload":2}`, so the page reloads, and a reload
landing before the rebuild finished would serve a bundle predating the recovery.

**It does not reproduce.** Driven by hand against a real `rsbuild dev` on `examples/rsbuild-spa`, with
the tap wired and `node_modules/.zintl` cleared, running the contract's exact sequence — append
`const syntaxErrorToken = ;`, wait 800 ms, remove it and rename the heading in one write — **three
consecutive cycles all recovered correctly**: `Recovered!`, `Recovered2!`, `Recovered3!`.

The server log shows the whole story working as designed:

```
[Zintl/Compiler/Extractor/WARN] OXC Parse Errors in …/src/main.ts
start   building src/main.ts
error   Build error:  × Module build failed … Syntax Error: Expression expected
error   build failed in 0.02s
start   building src/main.ts
ready   built in 0.04s
```

The extractor declines the unparseable file (L-043 leaving its boundary alone), Rspack reports the
build error, and the recovery compiles and reaches the page. A reload does occur — the settle beacon
reads the same value before and after — and the page still ends up correct, which is the specific
thing the race hypothesis said could not happen.

**So the hypothesis is retired, and the remaining failure is relocated rather than explained.**
`syntax-recovery` on `rsbuild-spa` fails ~3 runs in 4 _in the contract harness_ with the tap wired, and
passes by hand. That puts it in the same family as [L-031](#l-031) (the harness ran its dev server in
neither mode) and [L-036](#l-036) (two projects raced for one port): a defect in how the harness drives
this host, not in what Zintl does. Both of those were also mistaken for product defects first, and both
cost more than they should have because the environment was assumed innocent.

**What is not yet established** is which harness difference matters. The candidates are visible and
untested: the driver's programmatic `createRsbuild()` + `startDevServer()` against the CLI's path; a
dev server shared across every contract in a worker, on a project earlier contracts have already
mutated; and four workers competing where the manual run had one page and an idle machine.

**The tap stays out of the tree** — a contract that fails three runs in four is a red suite whatever
the cause. But the reason it stays out has changed, and that is the useful part: it is no longer
blocked on an unfixed runtime or compiler defect. Three were found and fixed getting here
([L-039](#l-039), [L-043](#l-043), [L-044](#l-044)); what remains is a harness question, and it should
be picked up as one.

### L-046 — L-044's fix was reverted: a correct change that made the suite worse

|                             |                                                                           |
| :-------------------------- | :------------------------------------------------------------------------ |
| **Status**                  | **Reverted** — the defect [L-044](#l-044) names is real and stays unfixed |
| **Bucket**                  | N/A — a correction to this ledger                                         |
| **Facet contract changed?** | No                                                                        |

[L-044](#l-044) closed on unit tests and explicitly on **no** end-to-end benefit, with a note that the
contract counts supported neither "improved" nor "regressed". Pushed on, they support "regressed".

**Matched protocol, eight runs of `hmr-hammer` each, same machine, back to back:**

| Configuration | Failures / 8 runs              |
| :------------ | :----------------------------- |
| With L-044    | **3**, every one `rsbuild-spa` |
| Without L-044 | **0**                          |

The mechanism is the change's own behaviour rather than a mystery: every rebuild re-registers the
manager, and L-044 made every re-registration re-load and re-apply a catalog. `hmr-hammer` edits as
fast as it can, so it turns that extra delivery per rebuild into extra traffic interleaving with the
content module's own push — and the stress contract is precisely the one built to notice a lost
update.

**Reverted**, along with its two unit tests and its changeset. The suite returned to its usual band
immediately: 149/149, 149/149, and one run with the standing `rsbuild-react` intermittent.

**What is _not_ withdrawn is the defect.** `registerLoader` really does discard a rebuilt manager's
fresh catalog, the two tests really did fail against the old behaviour, and the reasoning in L-044
stands. What is withdrawn is that particular fix: refreshing on every re-registration is too blunt,
because most re-registrations carry a catalog the store already has. A narrower version would refresh
only when the incoming catalog actually differs — which means comparing content rather than function
identity, and which nothing in this session measured.

**Two process notes, both mine.**

The revert deleted `globalRegistry.set(boundaryId, loader)` along with the block, because L-044 had
moved that pre-existing line inside it. Five unit tests failed instantly and said so; it was a
thirty-second fix. But it is the third time in this session that surgical text-slicing of a source file
produced a broken intermediate — twice leaving a file that would not parse — and each time the build
was the thing that caught it. Slicing by index is not editing.

And the ledger entry it corrects was written the same session it was refuted. L-044 said plainly that
the numbers justified nothing and that the unit tests were the whole argument. That was honest and it
was still not enough: **a change with a proof of correctness and no evidence of benefit is a change
with no evidence for shipping it**, and this suite makes that visible within about ten minutes of
looking.

## Phase 7 — closing Rsbuild: measurement first

Everything below was measured with `scripts/flake.js`, at N = 10, with the baseline taken in the
**same sitting** as the change. That instrument is the substantive change of this phase: four reverts
in the previous one were argued from three-run batches against baselines that had drifted, and two
"green" results turned out to have been measured against a `dist` whose build had failed.

### L-047 — the flush was fire-and-forget, and on Rspack it is the hot path

|                             |                                                             |
| :-------------------------- | :---------------------------------------------------------- |
| **Status**                  | **Fixed** — and it is what unblocked the tap                |
| **Bucket**                  | **2 — relocate it** (await it on the host where it matters) |
| **Facet contract changed?** | No                                                          |
| **Unblocks**                | [L-041](#l-041), [L-042](#l-042), [L-045](#l-045)           |

Wiring the `watchRun` tap (L-041's fix) made `syntax-recovery` on `rsbuild-spa` fail **9 runs in 10**,
against a pre-tap baseline of **0 in 10**. The five harness fixes that preceded it changed nothing:
`hmr.contract` measured **3/10 before and 3/10 after**, the same two cases each time. They were worth
making for other reasons, but they were not the blocker.

**The diagnosis, which the harness could finally give**, because those fixes had just taught it to
record `hash`/`errors` packets and to stop silencing the browser's own HMR client:

```
hmr packets: {"hash":4,"update":3,"full-reload":2,"errors":1}
last console lines:
    [info] [rsbuild] WebSocket connecting...
    [warning] [Zintl] Missing key "Recovered!" in boundary "b_src_main_render"
    [info] [rsbuild] WebSocket connected.
```

The server sent everything it should: `hash`+`errors` for the broken build, `hash`+`ok` for the
recovery. The page reloaded — and came back **missing the recovered key**. So this was never a lost
update. It was a bundle built from a catalog that had not been written yet.

**The cause.** `computeHotUpdatePlan` starts `flush()` and deliberately does not await it, with a
comment that is exactly right _for Vite_: there the browser's update is the re-evaluated content
module, served from the compiler's memory, so a disk write is not on the critical path. On Rspack it
**is** the critical path — the generated content and manager modules declare the catalog files as
dependencies (029 §3) and Rspack builds them by reading those files. With the flush still in flight,
the compilation the tap precedes reads the previous catalog.

The irony is precise: `watchRun` was chosen over `watchChange` _because_ it fires before module
building, and that earliness was then spent starting a write nobody waited for.

**Fixed** by awaiting the flush at the end of the Rspack tap, once per watch cycle rather than per
update — the one place the ordering can be guaranteed rather than hoped for. Vite's hook is untouched
and still does not block.

**Measured, same sitting:**

| Configuration                    | `syntax-recovery` / `rsbuild-spa` | per-run wall clock |
| :------------------------------- | :-------------------------------- | :----------------- |
| Pre-tap baseline                 | 0 / 10                            | 27 s               |
| Tap wired, flush fire-and-forget | **9 / 10**                        | 45 s               |
| Tap wired, flush awaited         | **0 / 10**                        | 32 s               |

The wall clock is the tell that this is the right layer: awaiting the flush made the suite _faster_,
because the late catalog write had been forcing a second compilation per edit — the cost 029 §4.1
recorded as inherent and used to justify leaving `memory` unclaimed.

### L-048 — L-044 was fixing a function the managers do not call

|                             |                                                           |
| :-------------------------- | :-------------------------------------------------------- |
| **Status**                  | **Closed — no fix needed**; the premise was wrong         |
| **Bucket**                  | N/A — a correction to [L-044](#l-044) and [L-046](#l-046) |
| **Facet contract changed?** | No                                                        |

L-044 reported that `registerLoader` discards a rebuilt manager's fresh catalog, and demonstrated it
with two unit tests. L-046 then reverted the fix for regressing `hmr-hammer` 3/8 → 0/8 while producing
no end-to-end benefit. Neither entry asked the obvious question: **which `registerLoader` does a
generated manager actually call?**

There are two. The generated manager emits

```js
globalThis.__zintl_active.registerLoader(manager.id, manager.loader);
```

— the **instance method**, which has no "already loaded" early return at all: it calls the loader and
applies the catalog every time, which is exactly the behaviour L-044 was trying to add. The early
return lives on the **module-level export**, reached through `registerZintlLoader` and injected into
transformed source.

So the defect L-044 described is real as a property of the exported function and **not reachable from
the path it was blamed for**. That is why the fix measured as pure cost: it made every re-registration
call a loader on a path that was already refreshing, and bought nothing.

**Not "fixed" here either.** Making the two implementations agree would change behaviour on a path
with no reachable failing case and no measurement — which is precisely the move that produced L-044,
L-046 and two of the reverts before them. It is recorded as a divergence worth knowing about: two
functions with the same name, one refreshing and one not, and only the non-refreshing one documented
as the interesting one.

**The lesson, and it is the same one three entries running.** L-044 shipped on a unit test that proved
the function did what the test said. It did not prove anyone called it. A proof of correctness is not
evidence of relevance, and "which caller reaches this?" is a cheaper question than any of the four
measurements that followed.

### L-049 — `chaos-boundary` named apps, and unnaming it did not make the capability claimable

|                             |                                                                                   |
| :-------------------------- | :-------------------------------------------------------------------------------- |
| **Status**                  | **Contract fixed; `chaos` still unclaimed on Rsbuild, now for a measured reason** |
| **Bucket**                  | **2 — relocate it** (per-project facts belong in the adapter)                     |
| **Facet contract changed?** | No — `ChaosAdapter.renameBoundary` is a testing-layer type                        |

`chaos-boundary` carried a `switch (exampleName)` returning hard-coded paths and throwing
`Unsupported example for boundary rename` for anything else. A contract naming apps is what the
contract layer forbids (CLAUDE.md, "Testing architecture"), and it had a concrete cost: claiming
`chaos` meant editing the contract, so a **contract** limitation was recorded in two manifests as a
**host** limitation.

The rename now lives in `ChaosAdapter.renameBoundary` — which file moves, where, whose import is
rewritten — and the contract fails loudly if a project claims `chaos` without it. The four projects
that already claimed it carry their previous values unchanged.

**And `rsbuild-react` still cannot claim it: 10 failures in 10.** The diagnosis is specific and is not
about renaming:

```
hmr trace:  watch (batch) → 1 modified
            enter …/src/main.tsx
[warning] [Zintl] Missing key "Count is {count}" in boundary "b_src_AppNew_tsx_default"
```

The contract writes the new boundary file and then edits its importer. Only `main.tsx` reaches the
watch hook — the newly created `AppNew.tsx` never appears in `modifiedFiles` at all, because it was
not in the dependency graph when the cycle began. Its boundary therefore has no catalog by the time
the page asks for one.

**A fix was attempted and reverted**, and it is worth recording because the hypothesis was reasonable
and wrong. The compiler ledger showed `flush #3 → superseded (joined the in-flight flush; dirt
retained for the next)`, so the tap was made to _drain_ — flush until nothing is dirty, bounded to
three passes to keep the known livelock impossible. Measured: **10/10 unchanged**, and the ledger line
identical. The retained dirt was a real observation and not the cause; a file the hook never hears
about cannot be flushed into a catalog by flushing harder.

So `chaos` stays unclaimed on both Rsbuild projects, and the reason has moved from "the contract will
not run here" to "a file created outside the dependency graph and imported in the same cycle is not
reported to the watch hook" — which is a smaller, sharper question, and the first honest statement of
it.

### L-050 — `memory` on Rsbuild: earned on one project, refused on the other, both measured

|                             |                                                                  |
| :-------------------------- | :--------------------------------------------------------------- |
| **Status**                  | **Resolved** — `rsbuild-react` claims it; `rsbuild-spa` does not |
| **Bucket**                  | N/A — a capability decision made on evidence                     |
| **Facet contract changed?** | No                                                               |

Both Rsbuild projects had `memory` excluded, and only one of those exclusions had ever been measured.
`rsbuild-spa`'s was reasoned from its own behaviour — every edit there is a full page reload, so twenty
sequential edits are twenty reloads, a reload resets the heap, and the settle beacon returns to the
value it already had, which is the one shape `waitForSettled` cannot confirm. `rsbuild-react`
inherited that verdict, and nothing about it applies: a React app updates in place.

Claimed on both, then measured in one batch of ten:

| Project         | `memory-leak`       |
| :-------------- | :------------------ |
| `rsbuild-react` | **0 / 10** — clean  |
| `rsbuild-spa`   | **10 / 10** — fails |

So `rsbuild-react` claims `memory` and `rsbuild-spa` does not, and both manifests now say which of
those is a measurement rather than an inference. This is the second inherited exclusion this phase to
turn out wrong on the project that inherited it (see [L-049](#l-049) for the first), and both were
inherited from the same source app.

**`performance` stays unclaimed on both, unchanged.** `performance-size`'s own header still opens with
`TODO: measure the payload this contract's name promises` and concedes that it runs against the dev
server and counts any `.json` as a catalog. That is a contract-quality problem on the Vite side that
happens to block a second host, and teaching it one more URL shape would entrench the thing it already
says is wrong.

## Phase 8 — the other two frameworks

Proposals 026–030 closed with Rsbuild supported "for React and vanilla", and with Vue and Svelte
described as _untested here rather than unsupported_ — nothing was known to break, and nothing had
watched them either. This phase built one example each and watched. Svelte needed nothing. Vue is
broken in the worst available shape.

### L-051 — Vue on Rspack builds green and ships the source locale

|                             |                                                                                      |
| :-------------------------- | :----------------------------------------------------------------------------------- |
| **Status**                  | **Resolved** — `sfcBlockRequestsCarryWholeFile`; three Vue examples ship             |
| **Bucket**                  | Silent wrong output — the one failure mode this project treats as worse than a crash |
| **Facet contract changed?** | **Yes** — one new bundler-facet flag; see the fix at the end of this entry           |

Reproduced on 2026-08-14 against `@rsbuild/core@2.1.10`, `@rspack/core@2.1.8`,
`@rsbuild/plugin-vue@2.0.1`, `vue@3.5.40`, on a `create-rsbuild` vue-ts starter with four locales.

**What happens.** Everything except code generation works, which is exactly why it is dangerous:

| Stage                              | Result                                                               |
| :--------------------------------- | :------------------------------------------------------------------- |
| Extraction from `.vue`             | ✅ correct — `src/App.vue` is read, stitched, and its boundary built |
| Catalog scaffolding                | ✅ correct — `zintl/src/App.vue.{ar,es,zh}.json`, right keys         |
| `verifyIntegrity`                  | ✅ fires on missing translations, so the build gates as designed     |
| Chunking / ghost mode              | ✅ one async chunk per non-source locale, none for `en`              |
| Catalog chunk contents             | ✅ correct — Spanish present under `b_src_App_vue`, ICU compiled     |
| HTML projection (`<title>`, `dir`) | ✅ correct — the document localizes                                  |
| **Codegen into the `.vue` module** | ❌ **absent** — zero `_t()` calls; the source literal ships verbatim |

So the page renders `<title>Rsbuild con Vue …</title>` above a body that says "Rsbuild with Vue". The
build is green, the contracts that snapshot compiler output would be green, and the app is wrong.

**Measured, not inferred:** the literal `Rsbuild with Vue` is present in both `dist/static/js/index.*.js`
and the dev server's `/static/js/index.js`, while the loaded content chunk
`virtual:zintl/content/es/entry:b_src_index_bootstrap` carries the correct Spanish. The anchor's own
file (`src/index.ts`) transforms fine and pulls in the manager — it is `.vue` specifically.

**Inferred, not yet reproduced at the loader level:** `vue-loader` compiles an SFC by emitting child
requests per block (`App.vue?vue&type=template`, `…&type=script`) through its pitcher, and those
requests are constructed so that pre- and normal loaders do not re-run. Zintl registers with
`enforce: "pre"` (`plugin.ts:65`), so it transforms the parent `.vue` request — whose output is used
for descriptor parsing — and never the block requests that actually become code. Plugin ordering was
ruled out by experiment: `...zintl()` before and after `pluginVue()` produce byte-identical output,
as expected, since Rspack orders loaders by `enforce` rather than by plugin registration.

`svelte-loader` has no equivalent split. It receives Zintl's transformed source directly, and
`examples/rsbuild-svelte-basic` renders fully translated in all four locales — first try, with no
Zintl change. The one Svelte-specific wrinkle is cosmetic and is documented in that example: a
sentence with an inline tag becomes `{@html}`, so Svelte's scoped-CSS pass prunes a selector like
`.content code` as unused, and the example uses `:global(code)`.

**Two things this changes about the support statement.** Svelte moves from "untested" to supported for
SPAs. Vue must move from "untested" to **explicitly not supported on this host**, because "untested"
invites someone to try it, and trying it succeeds quietly.

**What the fix has to decide**, and why it is not a patch: the block requests carry only one block's
text, and Zintl's Vue extraction is whole-SFC — it stitches `<template>` against what `<script>`
declares. Transforming `?vue&type=template` in isolation is a different extraction mode, not the same
one pointed at a smaller string. The alternatives worth costing are (a) teach the rspack facet to
transform block requests, with the extractor gaining a block mode; (b) contribute a Vue-on-Rspack
loader ahead of `vue-loader`'s pitcher; or (c) fence it — refuse the combination at config time with a
clear error, the way multiplex is fenced (L-022), and ship that first regardless of which of (a)/(b)
follows. **(c) should land before either**, on this project's own rule: a missing translation is a
build error, not a silent fallback to the source locale, and this is that rule being violated by the
integration rather than by the catalog.

### L-052 — Svelte's default `cssHash` hashes the filename, so a build snapshot cannot settle

|                             |                                                              |
| :-------------------------- | :----------------------------------------------------------- |
| **Status**                  | **Resolved** — the example pins `cssHash`; 6 clean runs in 6 |
| **Bucket**                  | Snapshot instability that reads as flake and is not          |
| **Facet contract changed?** | No — an application-level compiler option                    |

`examples/rsbuild-svelte-basic`'s `build` contract failed roughly one run in two, and the diff was
always the same shape and never the same value: `class="content svelte-8jxiy8"` against
`class="content svelte-1koy1i1"`, with byte-identical CSS on both sides.

The cause is one line of Svelte, and it is the default:

```js
// svelte/src/compiler/validate-options.js
cssHash: fun(({ css, filename, hash }) => {
  return `svelte-${hash(filename === "(unknown)" ? css : (filename ?? css))}`;
});
```

It hashes the **filename**, and only falls back to the CSS when there is no filename. The contract
layer materialises each project at `.tmp/runs/w<workerId>/<name>/`, so the filename — and therefore
every scoped class in the output — depends on which of four workers Vitest handed the job to. Two
observed hashes, two workers.

Fixed in the example rather than the harness, with
`cssHash: ({ css, hash }) => \`svelte-${hash(css)}\``, because the property worth having is that build
output is a function of the source. Normalising the hash away in `filterDistForSnapshots` would have
hidden a real difference in emitted CSS just as effectively.

**Why no Vite Svelte project hit this:** `examples/svelte-basic` and `examples/svelte-ssr` keep their
styles in a shared stylesheet, so no component has a `<style>` block and no scoped class is ever
emitted. The Rspack example keeps the block because `create-rsbuild`'s template has one. So this was
never a host difference — it was the first Svelte project in the suite with scoped styles at all.

**The near-miss worth recording.** The first two reproductions were read as "a contract left the
worker copy mutated", and the response was to wipe `.tmp/runs` and re-record — which produced a green
run, twice, and would have been reported as fixed. It only came apart because `vpr ci` failed again
immediately afterwards. A snapshot that is a function of the worker id passes about half the time, and
half the time is exactly the rate at which "wipe and re-record" looks like a fix.

### L-051, the fix — the host declares whether a block request carries the whole file

Added to the entry above rather than numbered separately, because it is the same finding closed.

**What the earlier write-up got right and wrong.** Right: `vue-loader`'s pitcher rewrites a block
request into a `-!` request, and `-!` disables pre-loaders. Wrong: the conclusion drawn from it, that
Zintl's transform therefore never reaches the block. It does. `genRequest` rebuilds the chain from
`context.loaders` — the loaders matched for the _child_ request — and Zintl's rule matches by resource
path, so it is in the chain, ahead of `vue-loader`. Measured with a probe on the transform hook:

```
transform id=…/src/App.vue                                        len=1836
transform id=…/src/App.vue?vue&type=script&setup=true&lang=ts     len=1836   ← whole file
transform id=…/src/App.vue?vue&type=style&index=0&…&lang=css      len=1836   ← whole file
```

Byte-identical lengths. The loader is handed the entire SFC on every block request, because the `-!`
request's resource is the original file.

**So the defect was one line of ours, not of the host's.** `hooks/transform.ts` skipped every id
containing `?vue` or `&vue`. That skip is correct on Vite, where `@vitejs/plugin-vue` _loads_ the same
id as a virtual module holding one block — transforming that fragment would hand the extractor a
partial document. It is wrong on Rspack, where the id re-reads the whole file. The parent request was
transformed and discarded; the block requests, which become the code, were skipped.

The skip had also been written as a framework test (`?vue`, `?svelte`) when the question it is really
asking is about the **bundler**. So the fix is a bundler-facet flag,
`BundlerFacet.sfcBlockRequestsCarryWholeFile`, declared `true` by `rspackFacet` and left undeclared by
`viteFacet`. `hooks/transform.ts` asks it instead of testing a query string, which keeps the rule out
of a bundler-agnostic hook — the same discipline `htmlFanOut` applies to multiplex.

On Vite the behaviour is unchanged, by construction: with the flag `false` the new condition reduces
to the old one.

**Cost:** a file with N block requests is transformed N+1 times. The transform is pure; a correct
render is worth the repeat.

**Verified:** `rsbuild-vue-basic`, `rsbuild-vue-spa` and `rsbuild-vue-mpa` render all four locales in
dev and in a production preview, RTL included, with a lazy route and a shared async boundary among
them. 25 contract cases across the three.

### L-053 — Vue's Options API was never supported, on either host

|                             |                                                                     |
| :-------------------------- | :------------------------------------------------------------------ |
| **Status**                  | **Open** — documented, not fixed; fails loudly rather than silently |
| **Bucket**                  | Framework support gap, mistaken for a host gap while chasing L-051  |
| **Facet contract changed?** | No                                                                  |

Found while testing whether L-051's fix covered `?vue&type=template`, which only appears when an SFC
is _not_ written with `<script setup>`. Converting `rsbuild-vue-basic`'s `App.vue` to
`defineComponent({ data, methods })` produced an empty page and:

```
[Vue warn]: Property "_t" was accessed during render but is not defined on instance
TypeError: _ctx._t is not a function
```

The mechanism is Vue's, not Zintl's. `<script setup>` compiles the template **inline into the setup
function**, so the imports Zintl injects into the script block are in scope for template expressions.
A plain `<script>` compiles the template into a separate render function whose expressions resolve
against the component instance — where `_t` is not, and cannot be, a property.

**Reproduced on Vite too**, by the same conversion applied to
`examples/vue-basic/src/components/HelloWorld.vue`: identical error. So this is not an Rspack gap and
L-051's fix neither caused nor could fix it. Every Vue example in this repository uses
`<script setup>`, which is why it had never surfaced.

Two things a fix would have to choose between, neither attempted here: inject through the component
instance (a `setup()`/`beforeCreate` mixin the codegen adds, so `_ctx._t` resolves), or refuse the
shape at extraction time with an error naming `<script setup>`. The second is cheap and is the
project's usual answer to "this would otherwise fail confusingly" — the current failure is at least
loud, which is why this is documented rather than urgent.

### L-054 — `VueLoaderPlugin`'s rule-set counter is module-scoped, and it reached a snapshot

|                             |                                                     |
| :-------------------------- | :-------------------------------------------------- |
| **Status**                  | **Resolved** — normalised in `sanitizeCode`         |
| **Bucket**                  | Snapshot instability that reads as flake and is not |
| **Facet contract changed?** | No                                                  |

`[Production Build] rsbuild-vue-spa` failed with a diff whose only content was `clonedRuleSet_12`
against `clonedRuleSet_66`, inside a generated binding name.

`rspack-vue-loader/dist/plugin.js` opens its rule cloning with `let uid = 0` at **module scope** and
names each cloned rule `clonedRuleSet-${++uid}`. A Vitest worker compiles several projects in one Node
process, so the number a given project gets depends on how many Vue projects that worker happened to
build first — which is scheduling, not source.

It could only ever surface here. The counter reaches emitted code through the re-export indirection
Rspack generates for a **lazily imported** SFC, which prints the entire loader chain into a variable
name; `rsbuild-vue-spa` is the first project with a lazy `.vue` route.

Normalised in `sanitizeCode` rather than pinned in the app, which is the opposite call from
[L-052](#l-052) two entries up, and the difference is worth stating: Svelte's `cssHash` had a
source-derived value to prefer, so pinning it made build output a function of the source. This counter
identifies a loader chain and nothing else — there is no better value to choose, and the only thing
normalising hides is the scheduling.

**Both were first read as flake**, and both were caught by the gate rather than by suspicion. That is
now three snapshot-stability defects in this phase (L-052, L-054) plus one silent-render defect
(L-051) that no snapshot could have caught. The pattern worth carrying: a snapshot is only as good as
the determinism of everything it embeds, and third-party identifiers embed whatever that party felt
like counting.
