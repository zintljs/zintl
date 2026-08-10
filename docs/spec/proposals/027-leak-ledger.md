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
