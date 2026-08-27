---
"@zintljs/extractor": minor
---

Add `obj:<binding>:<field>` and `call:<function>:<field>` — object-field targets you can narrow.

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
