---
"@zintljs/compiler": minor
"@zintljs/extractor": minor
---

Derive everything the graph knows about a string, for whoever has to translate it.

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
