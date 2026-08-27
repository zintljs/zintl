---
"@zintljs/extractor": minor
---

Add `@zintl-target` — the directive that opts a site in.

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
