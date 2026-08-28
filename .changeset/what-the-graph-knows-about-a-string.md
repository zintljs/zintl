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

One gap of the same family is left open and asserted rather than quietly shipped: a template literal
normalises `${user.firstName}` to `{user_firstName}` and keeps no bindings, so the placeholder
survives and the expression behind it does not. It holds for JSX interpolation and not for templates,
and the test says so.

Design, the seam this serves, and both decisions it rests on are in
`docs/spec/proposals/032-export-import-facets.md` — including §8.2, now settled: only an `approved`
translation is imported, because a gate is worth having only while it means exactly one thing.
