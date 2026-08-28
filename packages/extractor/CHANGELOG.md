# @zintl/extractor

## 0.1.0-alpha.19

### Minor Changes

- d1f0cd9: Add `@zintl-target` — the directive that opts a site in.

  `@zintl-ignore` has had no opposite. Zintl finds strings by _where they appear_ — in markup, in an
  `alt`, assigned to `textContent` — and a plain object is not one of those places and cannot be:
  `{ label: "…" }` is as often an analytics event as a button. So objects are matched by field name,
  which is a guess, and `obj:<binding>:<field>` narrows that guess to a name the project chose.

  Some sites have no name to narrow to.

  ```ts
  // @zintl-target
  export default {
    title: "Zintl — compile-time i18n",
    description: "Write your app in plain language.",
  };
  ```

  An anonymous default export has no binding at all. Neither does an object passed straight into a call
  whose callee the project does not control. And a name is the thing that breaks when somebody renames
  the variable — silently, because nothing was extracted, so `verifyIntegrity` has nothing to check.

  Marking the code instead survives the rename, works where no name exists, and is visible to whoever
  reads the file.

  **Inside a marked node every string field is taken, including nested ones**, whatever it is called.
  That is the point: the directive is for objects whose field names carry no signal, and a version that
  still required the names to be configured would only work where the configuration already did.

  `@zintl-ignore` is still honoured inside, so the two compose — mark the object, exclude the field that
  is a URL. A region ends where its statement does.

  Implemented as a region rather than a per-node flag, mirroring `@zintl-ignore`'s suppression level, and
  counted rather than flagged because regions nest and an inner one ending must not end the outer.

  One implementation note worth keeping: the `Property` visitor's registration gate previously asked "is
  any object-field target configured", and a `@zintl-target` can exist with none. The gate now also asks
  whether the file contains the directive — a one-off string scan per file. Dropping the gate instead
  would run the visitor on every `Property` in every project, including the many with no object targets,
  to answer "no" each time.

- d1f0cd9: Add `obj:<binding>:<field>` and `call:<function>:<field>` — object-field targets you can narrow.

  `obj:field:title` matches a `title` on **any object literal anywhere**. That is a guess about a noun,
  and it is how `{ label: "signup_button_click" }` ends up extracted, translated, and returned in Arabic
  at runtime. No curation of the field list fixes it, because the field name is the entire signal.

  These two narrow the same match by **context** instead:

  ```ts
  const ui = { home: { title: "Welcome" } }; // obj:ui:title      — nested is fine
  const mkUi = () => ({ title: "Welcome" }); // obj:mkUi:title    — functions too
  defineConfig({ title: "My site" }); // call:defineConfig:title
  ```

  Still a name — but one the project chose and controls, in its own codebase, rather than a guess about
  what a noun means in everybody's. That is the trade `dom:document:title` already makes, and it is what
  lets a target be declared rather than assumed.

  **The binding is the nearest one enclosing the object**, found by walking outward, so a field several
  levels down still belongs to it — `{ home: { title }, about: { title } }` is what a strings object
  actually looks like, and a direct-child rule would have missed the main use. The walk crosses function
  bodies for the same reason: `const ui = () => ({ title })` is as common as the plain form.

  `obj:*:<field>` is a new, honest spelling of the unqualified match; `obj:field:<field>` still works.

  **`call:` is deliberately its own family.** _Passed to `cfg()`_ and _bound to `cfg`_ are different
  relations, and one descriptor covering both would make `call:cfg:title` match a `const cfg = { title }`
  that has nothing to do with the call. There is a test for exactly that.

  `export default { … }` carries no name and cannot be targeted this way. A stated limit rather than an
  oversight — there is nothing to declare against, and marking the site is what a directive is for.

  The descriptor forms are documented in `docs/configuration.md`. Defaults are unchanged: `obj:field:*`
  stays in the built-in set until the two examples that depend on it have somewhere to go — see
  [proposal 033](../docs/spec/proposals/033-structural-defaults-and-declared-targets.md) §8.

- 810ef00: Add `additionalTargets`, and make the target wildcard work in both positions.

  **`additionalTargets` extends what the active facets detect.**

  ```ts
  zintl({
    locales: ["en", "ar"],
    additionalTargets: ["obj:details:*"],
  });
  ```

  `targets` on a facet _replaces_ that facet's list — right for reconfiguring one, and useless for _"the
  defaults plus one of mine"_: appending a single entry meant re-listing every default, and such a
  config falls behind silently the moment the defaults move.

  A route existed — contribute your own extraction facet, since array capabilities union across them —
  but it required knowing that facets union, that `concern: "extraction"` is the slot, and that the name
  must differ from a built-in or the provenance rule _replaces_ rather than adds. That is a lot of
  mechanism for one target.

  The name is doing work. `targets` would read as _all_ the targets, which is precisely the wrong
  promise; `additionalTargets` cannot. It is carried internally as a synthetic facet, so it inherits
  union semantics, shows up in the activation trace, and needs no second code path that could disagree
  with the first.

  A sentinel — `targets: ["auto", …]`, mirroring `facets: ["builtins"]` — was considered and rejected.
  `facets` is expanded by the plugin, while `targets` is parsed by the extractor's deliberately
  framework-blind DSL, so a sentinel would either leak an orchestration concept into that parser or mean
  one thing at the top level and another on a facet. It would also reserve a bare word in a namespace of
  prefixed descriptors, foreclosing any future bare-word form.

  **`*` now works in either position.**

  ```ts
  "obj:*:title"; // any object's `title`
  "obj:details:*"; // every field of an object named `details`
  ```

  The second used to parse, store `"*"` as a literal field name, match nothing, and **pass validation** —
  a structurally valid triple with no empty segments. Silently doing nothing, one position over from
  where descriptor validation had just removed it. `call:<fn>:*` works the same way.

  `obj:<binding>:*` is the more useful half in practice: it says _this object holds UI strings_ without
  listing them, which is what a project reaches for when the same shape repeats across components.

  See [proposal 033](../docs/spec/proposals/033-structural-defaults-and-declared-targets.md) §9.2.

- 0177060: Derive everything the graph knows about a string, for whoever has to translate it.

  A catalog is `{ "Open": "" }`. Next to the code that is exactly right — the source text is the key
  and the call site is a click away. Handed to a translator with no repo and no screen it is close to
  worthless: they cannot tell whether _Open_ is a verb or an adjective. Every TMS answers this with a
  hand-written context field that goes stale the day after somebody types it.

  `ZintlCompiler.getMessageContext(boundaryId, key)` answers it from the boundary graph instead, which
  means it cannot go stale:

  - **Which screens the string reaches** — the entry points that actually depend on this boundary.
  - **What else an edit would change** — every other boundary carrying the same words. Translators are
    never told this, and it is the difference between a safe edit and a regression.
  - **What produced each placeholder** — `{input}` alone is unanswerable; `user.firstName` is not.
  - **Where it sits** — `alt`, `button`, `h1` — plus the `@zintl-note`, the tag map, and whether it is
    part of a larger stitched sentence.

  None of this is new machinery; it is a read off graphs the compiler already keeps. The derivation
  lives in `packages/compiler/src/message-context.ts` as a pure module over explicit inputs, in the same
  shape as `reconcile.ts`, so the structurally interesting cases are testable without constructing a
  compiler at all.

  **An `<h1>` and a `<p>` are no longer the same thing.** They were: every HTML text node reached the
  compiler as one sink type, so "this is an `aria-label`, not an `h1`" was true for JSX and false for
  every MPA and every vanilla app. `stitchHTML` now tracks the open block elements and reports the
  enclosing one on a new `context` field — never on `sinkType`, which is how the pipeline splices a
  call back into the document and is compared for equality in three places. Human-facing context and
  replacement mechanics are two questions, and they were sharing one string.

  The element is metadata and never a key, which is what makes this safe: `generateMessageId` ignores
  the context it is passed, so an `<h1>` and a `<p>` holding the same words remain one translatable
  unit with two recorded contexts. No message identity moves, no catalog changes, and the 383-test
  contract suite produced no snapshot diff.

  **Fixes a rendering bug found on the way.** A template literal inside JSX — as a child or in an
  attribute — lost its interpolations entirely:

  ```js
  <h1>{`Welcome back, ${user.firstName}!`}</h1>;

  _t("Welcome back, {user_firstName}!", { _mgr, _bId }); // before
  _t("Welcome back, {user_firstName}!", { user_firstName: user.firstName }, { _mgr, _bId }); // after
  ```

  No params object, so the value never reached the page: the built page rendered `Welcome back,
undefined!`.

  The cause was three copies of one derivation. `${user.firstName}` becomes `{user_firstName}` in the
  extracted text, and three places decided that independently — the template branch that names the
  placeholder, the DOM-sink path that pairs a name back to its expression, and the JSX path that did the
  same. Two agreed; the JSX copy handled only bare identifiers, so a member expression was `var0` there
  and `user_firstName` everywhere else. Bindings are matched to placeholders **by name**, which is why
  it was silent: a mismatched name produces no binding rather than a wrong one. There is one copy now.

  Nothing caught it because no project in the manifest used a template literal inside JSX —
  `vanilla-ssr` uses one on a DOM assignment, the route that already worked, and every JSX project
  writes plain JSX children. Two well-covered halves of one feature and nothing across the join.

  That is closed too: a unit test asserting the emitted call rather than the manifest, and a
  `jsx-template` contract fixture that renders the shape in a real browser. Both were confirmed to fail
  with the fix reverted, which is what makes them guards rather than descriptions.

  Design, the seam this serves, and both decisions it rests on are in
  `docs/spec/proposals/032-export-import-facets.md` — including §8.2, now settled: only an `approved`
  translation is imported, because a gate is worth having only while it means exactly one thing.

## 0.1.0-alpha.18

### Minor Changes

- 3bb8466: Extract translatable attributes from markup written inside a JavaScript template.

  An `alt`, `title`, `placeholder` or `aria-label` was extracted from an HTML document, from a Vue or
  Svelte SFC template, and from JSX — and **silently dropped** from the same markup written inside a
  JS template literal, which is how every vanilla app and every Lit component writes it. Nothing
  failed; the string simply never reached a catalog, so no translator ever saw it.

  It was live in one template localized six ways. `react-basic`, `preact-basic`, `solid-basic` and
  `vue-basic` all had `"Vite logo"` in their catalogs. `lit-basic` and the nine vanilla apps did not,
  from identical markup.

  **The cause** was that attribute extraction existed in exactly one place: a loop inside `extractHtml`,
  which runs only for `.html` documents and SFC template blocks. The JavaScript path —
  `findLiteralsInExpression` — called `stitchHTML` for text nodes and never looked at attributes.

  So the loop became `scanTranslatableAttributes`, in its own module because `context.ts` cannot import
  `html.ts` without closing a cycle, and both literal branches now call it. What made it shareable is
  that each caller already had the thing that differs: a function mapping an index in the markup to a
  source offset. An HTML document adds a constant; a template literal walks its quasis — and _refuses_,
  by throwing, for a range crossing an interpolation. The scanner reads that refusal as "skip", which is
  what keeps `src=${logo}` from being mistaken for a translatable string.

  **No new capability was needed**, because of one choice: inside a JS template the sink covers the
  attribute's **value**, not the whole attribute, and carries `isFragment`. The existing fragment path
  then drops a `${…}` between quotes that are already there —

  ```js
  el.innerHTML = `<img alt="${_t("Vite logo", …)}" />`;   // plain JS
  html`<img alt="${_t("Vite logo", …)}" />`               // a Lit quoted binding
  ```

  — which is valid in both hosts at once. `wrapHtmlAttribute` is correspondingly gated on `!isFragment`:
  it rewrites the attribute _and its name_, which is right for the whole-attribute form and would emit
  the name twice for a fragment.

  Attribute values containing an interpolation (`title="Hello ${name}"`) are skipped rather than
  mangled. That matches the paths that already worked — `.html` and SFC extraction both pass
  `variables: []` — so it stays one limitation shared by every path instead of becoming a per-path quirk.

  Eleven example apps now extract strings they were losing; the `.html` and SFC transform snapshots do
  not move at all, which is what says the lifted loop still behaves as it did on the path it came from.

- 6aafef8: Add Preact, Solid and Lit — the three frameworks `create-vite` and `create-rsbuild`
  scaffold that Zintl did not support.

  Zintl's claim has been that another framework is additive work rather than a core rewrite. That was
  untested against anything the project did not write itself: of the eight templates `create-vite`
  scaffolds, four had no support at all. Three of them do now, on both hosts.

  **Preact** is the claim holding up. Its extraction is React's — both read one shared `JSX_TARGETS`
  list, because JSX is JSX — and it differs in exactly two declarations. The subscription hook comes
  from `preact/compat`, not `preact/hooks`. And re-running the entry is _safe_ here where it is not in
  React: `createRoot` mounts a second root over a container it already owns, while Preact's `render()`
  diffs against the tree already there. Measured before it was declared — seven consecutive entry
  edits, one `#center` throughout, with a `window` marker surviving to rule out a page reload.

  **Solid** is the claim being stretched, and it found a real defect. A Solid component runs once; its
  JSX compiles to fine-grained effects, so subscribing it has nothing to act on. It uses the
  `reactiveBridge` seam Vue already had, mirroring the store into a signal whose read is spliced into
  every `_t` call — so rendering a translation _is_ taking the dependency, and no sink can be missed.
  The observable result is the nicest in the suite: switching locale remounts nothing, and a counter
  keeps its value across two switches where every other framework example throws it away. Verified in a
  browser by marking DOM nodes before a switch and finding the same nodes carrying the new text.

  Solid's limit is on the other side, and is a property of Solid rather than a gap here: a component
  does not self-accept a catalog invalidation, so it propagates to the entry, and re-running a Solid
  entry is unsafe — `render(code, el)` called twice on one element leaves **two** children, measured.
  So a _translation-file edit_ arrives by reload and `solid-basic` claims no `hmr`. The template's
  `/* @refresh reload */` was the obvious suspect and was ruled out: removing it changes nothing.

  The defect it exposed: the compiler injected `useSyncExternalStore(...)` into any file with component
  functions, gated only on server components. Vue and Svelte escaped because their SFCs have no
  component functions to find — a property of their file format, not a decision — so the first JSX
  dialect _without_ a hook got a call to an undefined name. The injection is now gated on the framework
  having declared a hook to call, which is what the condition should always have been.

  **Lit** needed capability rather than configuration, and each addition is framework-blind:

  - `` tag:`<name>` `` in the extractor — "the contents of a template literal tagged with this
    identifier are markup". Lit's markup is neither a file format nor JSX but a tagged template inside
    an ordinary module, and neither existing seam reached it: an `sfcRules` entry for `.ts` would
    hijack every module in the project or leave the code around the template unextracted, taking the
    `zintl()` anchor with it. htm and uhtml get this from the same declaration.
  - `CodegenFacet.codegenImports` — what a dialect's _generated_ markup references. React's
    `dangerouslySetInnerHTML` and Svelte's `{@html}` are syntax; Lit's `unsafeHTML` is an import.
  - `CodegenFacet.wrapTemplateFragment` — how a `_t` call is interpolated into a surrounding template
    literal. `${…}` was hardcoded, which is right for a vanilla `innerHTML` template and wrong for Lit,
    where an interpolated string is deliberately rendered as text.

  Lit's limits are declared rather than papered over: `repaintsOnCatalogUpdate` is left undeclared,
  because repainting a live element needs a registry of connected components — a mixin, which is
  application code — and `lit-basic` claims no `hmr` capability as a result.

  Coverage is a real example app per framework on Vite plus an inline Rsbuild fixture, following
  `tests/manifests/index.ts`'s own guidance that cost is roughly (projects × matching contracts). The
  contract suite goes from 309 to 364.

  The three apps are scaffolded from `create-vite` — `preact-ts`, `solid-ts`, `lit-ts` — not
  approximated from a sibling example, which matters because the templates differ in ways that would
  otherwise have gone untested. `lit-ts` renders into a **shadow root**, keeps its whole stylesheet in
  a `css` tagged template, and slots its `<h1>` from `index.html`; `preact-ts` names its component
  `app.tsx` and writes `class` rather than `className`. `examples/lit-basic/src/my-element.ts` is the
  template's own file — diffed against a fresh scaffold, it differs only by this repo's formatter and
  one `@zintl-ignore` line, with no change to logic, structure or markup. That is the strongest form of
  the claim this change makes.

  Detection prefers Preact over React and resolves it after both scans, because `@preact/preset-vite`
  aliases `react` — a project resolving as both would activate two codegen facets claiming `.tsx`,
  which is a hard error by design. Solid is matched on separator boundaries so `splitVendorChunk` is
  not read as a framework, and Lit is detected from dependencies only, since it has no plugin on either
  host.

  Qwik remains unsupported: it is Vite-only, and resumability against a module-level reactive store is
  a question about the runtime rather than a facet.

## 0.1.0-alpha.17

## 0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- 8d8f942: Fixed client reactivity never being injected into plain React apps (ledger L-032), which also fixes the empty-render defect on Rspack (L-030) for framework apps.

  **The gate asked the wrong question.** `useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)` was injected only into files where `observation.isClientComponent` held — and that is literally `code.includes('"use client"')`, a React Server Components directive. A plain React SPA never writes it, so no component in `react-basic`, `react-ssr` or a React app on any host subscribed to the store at all. Exactly one file in this repository carried the directive.

  `RuntimeFacet.serverComponents` now decides it, declared `true` only by the Next.js runtime facet. Where a framework separates server components from client ones, the directive still gates injection; everywhere else every component is a client component. Both the import gate and the injection gate move together, so a file cannot import a hook it never calls.

  **A second defect was hidden behind the first.** `registerComponentFunction` marked the outermost function containing _any_ JSX, with no name check — so a `bootstrap()` that merely calls `createRoot(el).render(<App />)` was treated as a component. Enabling the gate turned that into `Invalid hook call` and a blank page. It now requires a capitalised name, from the declaration or the binding an expression is assigned to, which is React's own rule; an unnamed function is not marked, because failing to subscribe degrades a repaint while a hook in a non-component breaks the app.

  **Why this mattered beyond React.** On Vite the missing subscription had no visible consequence — its module ordering makes the first render correct, so nothing ever needed repainting. On Rspack a catalog can arrive after the render, and with no subscriber the page stayed permanently blank. `examples/rsbuild-react` now claims `hmr`.

  Generated React output changes: components gain a `useSyncExternalStore` call and the corresponding imports.

## 0.1.0-alpha.14

## 0.1.0-alpha.13

## 0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- 7c69554: Updated external dependencies:

  - vite-plus@0.2.7

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- Rename the main package from `zintl` to `zintljs`.

  npm rejects the bare name `zintl` under its package-name similarity filter (`Package name too similar to existing packages intl,vinyl`). The name is unobtainable, so the primary package is now **`zintljs`**, matching the `@zintljs` npm org and the `zintljs` GitHub org.

  **What changed for consumers:**

  ```diff
  - npm install zintl
  + npm install zintljs

  - import zintl from "zintl/vite";
  - import { zintl } from "zintl/macro";
  + import zintl from "zintljs/vite";
  + import { zintl } from "zintljs/macro";
  ```

  **What did not change:** the `zintl()` macro itself. The package name and the exported identifier are deliberately separate — `ZINTL_MACRO` still resolves the `zintl(...)` call expression, and `bindings` in the boundary graph still read `"zintl"`. Only module specifiers moved.

  Internal `virtual:zintl/*` module IDs are unchanged; they are not npm names and keep the project's brand prefix.

  `RUNTIME_PACKAGE` and `RUNTIME_SPECIFIERS` in `@zintljs/extractor`, and `MACRO_PACKAGE` in `@zintljs/compiler`, now point at `zintljs`. Because those constants are baked into the compiler's published output, `@zintljs/compiler@0.1.0-alpha.6` cannot recognize the new specifiers and is superseded by this release.

## 0.1.0-alpha.6

### Minor Changes

- 448dbc6: Made `@zintljs/extractor` genuinely framework-blind. A previous changeset claimed the extractor had been "fully decoupled" from framework presets; that was inaccurate — the tables were left in place, duplicating the facet presets, and one of them was still on a live code path.

  **Deleted from `targets.ts`:**

  - `TARGET_PRESETS` — full descriptor lists for `vanilla`, `react`, `nextjs`, `vue`, `svelte` and `html`.
  - `TARGET_METADATA` and the `TargetMetadata` type — Vue and Svelte SFC block rules, Svelte's mustache pattern, and the Next.js `generateMetadata` / `generateViewport` suppression rules.
  - `DEFAULT_SFC_RULES` and `DEFAULT_SUPPRESSION_RULES`.

  Every one of these duplicated a facet preset in `@zintljs/compiler/facets`, which is now the single source of truth. The Vue and Svelte block rules were byte-identical to their preset counterparts.

  **Removed the one live leak.** `parser.ts` fell back to `DEFAULT_SFC_RULES` whenever the caller's rules did not cover a file's extension, so any `.vue` or `.svelte` file received Vue/Svelte block-splitting from the extractor itself even when no rules were supplied. SFC rules are now caller-supplied only.

  **`TargetDescriptor` no longer names a framework.** The `"auto" | "react" | "nextjs" | "vue" | "svelte" | "html" | "vanilla"` members are gone, leaving only the structural forms (`jsx:*:attr`, `jsx:El:attr`, `dom:prop:x`, `dom:attr:x`, `obj:field:x`, `html:attr:x`) and `TargetPlugin`. `resolveTargets` is correspondingly reduced to pure structural compilation — descriptors into lookup sets, plugin collection and a fast-path regex — with no preset expansion and no rule derivation.

  **No default target set.** `parser.ts` and `context.ts` both defaulted to `["vanilla", "react", "html"]`. A framework-blind executor has nothing sensible to guess, so callers now declare their sinks; production supplies a fully compiled state from the resolved facets.

  **Removed dead sink opinions.** `DEFAULT_UI_ATTRIBUTES`, `DEFAULT_UI_OBJECT_FIELDS`, `DEFAULT_UI_SINK_PROPERTIES` and `TEMPLATE_ATTR_REGEX` encoded which DOM and JSX attributes are translatable. All four were already unreferenced — one survived only inside a commented-out line.

  **Fixed drifted runtime-specifier detection.** The check for Zintl's own module specifiers was inlined at four sites (`parser.ts`, two in `visitors/program.ts`, one in `visitors/bindings.ts`) and the copies had diverged: the `bindings.ts` variant omitted the bare `"zintl"` literal, so a project configuring a custom `runtimePackage` would have had bare `"zintl"` imports recognised by three checks and missed by the fourth. All four now call the new `isRuntimeSpecifier` helper, backed by a single `RUNTIME_SPECIFIERS` list.

  **Verification.** The contract snapshots passed with zero diffs, which is the proof that the deleted tables were dead in production. Three new architecture tests assert that the extractor names no framework anywhere in its source, exposes no preset tables, and that `resolveTargets([])` yields a genuinely empty world.

- e1e504d: Prepare the packages for their first public release.

  - **Renamed the npm scope** from `@zintl/*` to `@zintljs/*`. The `zintl` org name was unavailable on npm; the primary package remains `zintl`, so application code importing `zintl` and `zintl/macro` is unaffected. Only direct consumers of `@zintl/compiler` and `@zintl/extractor` need to update.
  - **Corrected the Vite peer range** to `^6.0.0 || ^7.0.0 || ^8.0.0`, verified by building a real app against stock Vite 6.4.3, 7.3.6, and 8.2.0. The plugin relies on the Environment API (`hotUpdate`, `this.environment`), which does not exist in Vite 5, so the previous `^5.0.0` range advertised support that could never work.
  - **Pinned `oxc-parser` and `@oxc-project/types`** to `^0.142.0` in the workspace catalog. They were set to `latest`, which would have published `@zintljs/extractor` with an unpinned runtime dependency on a pre-1.0 parser.
  - **Trimmed the publish surface** with an explicit `files` field. The `zintl` tarball drops from 91 files (535 kB unpacked) to 13 files (103 kB) — build config and sources are no longer shipped.
  - **Added `engines`, `repository`, `homepage`, `bugs`, and `keywords`** to every published package, and gave `@zintljs/compiler` and `@zintljs/extractor` their own READMEs.
  - **Moved npm provenance out of `publishConfig`** so that publishing is possible outside of CI. Provenance requires a public source repository and CI OIDC; it is re-enabled via `NPM_CONFIG_PROVENANCE` in the release workflow.
  - **Marked `@zintljs/testing` as private.** It backs the internal e2e suite only and is no longer part of the release surface.

### Patch Changes

- a7f080f: Fully decoupled high-level framework presets (`"vue"`, `"svelte"`, and `"nextjs"`) from `@zintljs/extractor`'s core logic. The extractor has no hardcoded references to these framework target-presets, meaning all SFC block parsing rules, metadata suppression rules, and mustache regular expression patterns now flow downward from compiler-resolved adapters.

  Evolved the extractor's mustache rule matcher to dynamically match intermediate or virtual file extensions (e.g. `.vue.html` and `.svelte.html`) to ensure correct template variable extraction and production catalog baking in Vue and Svelte.

## 0.1.0-alpha.5

### Patch Changes

- 85504fe: Refactor extractor fast-path and boundary assignment to be fully driven by configuration and structure, removing all sink-based speculation.

  **Fast-path & Target-Driven Optimizations**:

  - **`types.ts`**: Added `"nextjs"` as a supported `TargetDescriptor`.
  - **`targets.ts`**: Introduced the `"nextjs"` target preset (which inherits standard JSX/object field rules). Completely eliminated framework-specific target flags (`isReactTarget`, `isVueTarget`, `isSvelteTarget`, `isNextjsTarget`) from `ResolvedTargets`.
  - **`context.ts`**: Removed the target boolean flags from `ExtractionContext`, resolving rule sets (like `mustacheRegex`) dynamically using configuration target presets and extension-based fallbacks.
  - **`parser.ts`**: Replaced the hardcoded `isLikelyUI` check with `resolved.fastPathRegex.test(code)`.
  - **`visitors/index.ts`**: Conditionally mount the JsxVisitor only when JSX targets are active.
  - **`visitors/bindings.ts`**: Conditionally register AST hooks for `AssignmentExpression` (only if DOM targets are active) and `Property` (only if object fields are configured), bypassing expensive node checks.
  - **`visitors/program.ts`**: Decoupled Next.js metadata/viewport export suppression logic from standard React projects, gating it dynamically via the target suppression metadata rules.
  - **`html.ts`**: Optimized mustache template parsing by using target flags, and refined SFC template checks using path extensions combined with targets to prevent stripping the `htmlProjection` metadata on top-level static HTML entry pages (like `index.html`).
  - **`hooks/config.ts`**: Added auto-detection for the `"nextjs"` framework when `"next"` or `"vinext"` is detected in package dependencies or plugin lists.

  **Declarative Extractor Languages (Knowledge Zeroing)**:

  - **SFC Segmentation Language**: Added `SfcRule` and `SfcBlockRule` interfaces. Extractor now splits Vue, Svelte, and Astro SFC files using fully custom, declarative regex-based block segmentation rules instead of hardcoded splitters.
  - **AST Suppression Language**: Added `SuppressionRule` interface. Extractor AST walker checks nodes generically against configurable suppression criteria (matching types, names, and root-level scopes) to bypass zero-config extraction on server-only subtrees.
  - **Generic Parsers**: HTML extraction and AST visitors are decoupled from framework file extension checks, dynamically utilizing the resolved rules (such as `mustacheRegex` and `activeRange`/`isSfcTemplate` for HTML template stitching).

  **Boundary assignment (structural)**:

  - **Removed `hasSinksOrCalls`**: The recursive subtree walk that speculatively assigned sub-boundaries to any function with UI sinks is gone. It was a second tree traversal inside the first walk and relied on framework-specific hardcoded checks (`["innerHTML", "innerText"]`, unconditional JSX node checks).
  - **Replaced with structural rule**: Every top-level **exported** function gets its own sub-boundary deterministically — no sink scan required. The compiler's binding tracker uses these to attribute strings precisely when a consumer imports only a subset of a file's exports. In zero-config mode, all top-level functions (including non-exported) get sub-boundaries, mirroring the existing fast-path behavior.
  - **Local functions** (non-exported, no explicit `zintl()` anchor) now correctly collapse to the file's root boundary. The compiler's boundary graph handles reachability at the file level.

  **Effect**: The extractor now has two sources of truth for boundaries — explicit `zintl()` anchors and structural exports — with no guessing about sink content. Framework knowledge lives entirely in `ExtractionOptions.targets`.

- 0bd00a8: Fix evaluation of dynamic attributes, tag replacement, and boundary resolution in JSX/SFC compilation:

  - **Export and Import Boundary Resolution**:
    - In `@zintl/extractor`: Maps default and named exports of components to their precise function-level boundary IDs (e.g., `src/App:App` instead of the file boundary `src/App`) in the program visitor.
    - In `@zintl/compiler`: Resolves static import bindings to their precise exported function-level boundary IDs when walking the dependency graph in `intent-utils.ts`, and adds file-level fallback resolution to ownership mapping checks.
  - **Dynamic JSX Attribute Evaluation**: Serializes `_tags` for JSX components as raw JavaScript array literals rather than JSON strings, allowing local scope variables (like imported assets) to be correctly evaluated at runtime.
  - **JSX to HTML Attribute Mapping**: Automatically maps `className` to `class`, and JSX attribute expressions like `src={logo}` to template literal interpolations `src="${logo}"` for elements inside translated templates.
  - **Self-Closing Tag Placeholders**: Extends the runtime key resolver and compile-time baking to support self-closing tags (both `<tag/>` and `<tag />`) when replacing translatable element placeholders.

## 0.1.0-alpha.4

### Patch Changes

- Updated external dependencies:
  - @types/node@^24.12.4
  - typescript@^5.9.3

## 0.1.0-alpha.3

### Minor Changes

- 776aca8: Introduce Single File Component (SFC) extraction/transformation for Vue and Svelte, automatic target resolution, and performance optimizations:
  - **SFC Extraction Support**: Added support for `.vue` and `.svelte` templates and scripts in `@zintl/extractor`. Implemented script block slicing, tag stripping, and position/offset translation for variables, transforms, and locations to map them correctly back to the original source file.
  - **Vue & Svelte Target Presets**: Expanded Target Presets to include comprehensive configurations for Vue and Svelte elements (e.g., translatable attributes like `alt`, `placeholder`, `aria-label`).
  - **Dynamic HTML & Attribute Wrapping**: Added support for SFC-aware rewriting in `@zintl/compiler`. HTML text nodes with dynamic nested tags are automatically wrapped in framework-specific logic (`<span v-html="...">` for Vue, `{@html ...}` for Svelte), and normal text interpolations map to `{{ ... }}` or `{ ... }`. HTML attributes are transformed into reactive bindings (`:attr="..."` or `attr={...}`).
  - **Automatic Target Detection**: Added an `auto` option to the plugin targets. It dynamically queries the project `package.json` dependencies and Vite plugin configurations to auto-configure appropriate extraction targets.
  - **Compiler Flush Performance Recovery**: Optimized the compiler's warm-path flush latency to resolve benchmark regression:
    - Cached the reachable graph nodes in `ZintlCompiler` (`reachableCache`) to avoid repetitive DFS traversals per locale/boundary.
    - Implemented string comparison caching (`lastManifestContent`) for metadata manifests in `MessageManager` to bypass redundant disk writes/reads.
    - Bypassed empty synchronization tasks for assets and HTML projections when there are no updates.
    - Added on-disk verification caching (`confirmedOnDisk`) for catalogs and schemas to avoid multiple expensive `fs.exists` checks on subsequent rebuilds.
  - **Vite Transform Query Safety**: Configured the transform hook in the Vite plugin to skip transforming modules containing query parameters unless they are explicitly tagged with `zintl-multiplex=`, avoiding conflicts with non-JS file assets.
  - **ICU Baker Warnings**: Refined ICU message checking warnings to bypass mustache expressions (`{{ ... }}`) and focus warnings only on actual syntax errors.

### Patch Changes

- 18a7166: Added support for inline SVG elements during HTML/JSX parsing and resolved fanned routing redirect intercepts in development mode:

  - **SVG Phrasing Elements Support**: Added common SVG child tags (`use`, `path`, `circle`, `rect`, `g`, etc.) to the list of inline phrasing tags. This prevents HTML/JSX text stitching from partitioning at unrecognized sub-tags, eliminating unmatched closing tag validation errors and schema warnings during catalog compilation.
  - **Fanned Routing Support in Dev Mode**: Updated the Vite development index HTML interception logic to inspect both the filesystem path and request path. This prevents custom SSR development servers from rendering empty redirect shells when navigating fanned localized routes.
  - **Request-Scoped SSR Compilation**: Restricted contextual anchor locale baking in the compiler transform when performing server-side builds. This ensures that multi-locale Express/custom SSR servers can generate request-scoped translations dynamically.

- 776aca8: Fix HTML catalog generation pollution in SFC templates, ignore only-variable text nodes, and optimize translation loader generation:
  - **SFC Catalog and Schema Sanitation**: Prevent `.vue` and `.svelte` files from being incorrectly identified as HTML document projections. This stops the creation of schema files and catalog files containing page-level settings (like `dir`) for SFCs.
  - **Variable-Only Text Node Omission**: Ignore text nodes inside Vue/Svelte SFC templates that only contain variables (e.g. `{{ l.name }}`), avoiding empty translation key generation (`"{var0}"`).
  - **Kingdom-Based Loader Optimization**: Optimize the compilation rewrite of the `zintl` macro. If a boundary manager (and all of its child boundaries/colony files) does not contain any translatable messages or asset dependencies, it is omitted from loader registration to minimize runtime initialization overhead.

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:

  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🟢 1 benchmark(s) improved (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                    | Baseline  | New Run                          | Calibrated Delta | Status    |
  | :--------------------------- | :-------- | :------------------------------- | :--------------- | :-------- |
  | Extract Long File (200 keys) | 1574.7 µs | 1618.5 µs (1432.9 µs calibrated) | -9.01%           | 🚀 Faster |

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.

## 0.0.3

### Patch Changes

- d2d7d9b: Optimize HTML and JSX extraction, phrasing-tag normalization, and comment directive handling:
  - **Nested Phrasing Tag Support**: Flawlessly parses and normalizes deeply nested phrasing tags (e.g., `<a>read <code>instructions</code></a>`) without disrupting tag open/close balances or generating malformed outputs.
  - **Transparent Phrasing Directives**: Allows HTML comment directives (`@zintl-note` and `@zintl-pass`) to live inside phrasing tag boundaries without partitioning the translatable string, propagating meta annotations seamlessly to translators.

## 0.0.2

### Patch Changes

- Optimize HTML and JSX extraction and phrasing-tag normalization:
  - **Phrasing Tag Collapsing**: Collapses exactly identical phrasing tag configurations (e.g. identical `<span>` tags) to a single clean base alias, avoiding redundant numbering and duplicate entries in translation catalogs.
  - **Heterogeneous Tag Numbering**: Retains stable numbering (`span1`, `span2`) exclusively for tags that carry different classes, attributes, or IDs to preserve translation safety.

## 0.0.1

### Patch Changes

- Normalize Windows-style CRLF (`\r\n`) line endings to LF (`\n`) at the start of both JS/TS and HTML extraction pipelines. This guarantees platform-independence and prevents range/offset alignment mismatches.
