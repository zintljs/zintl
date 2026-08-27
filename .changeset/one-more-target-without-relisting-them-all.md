---
"zintljs": minor
"@zintljs/extractor": minor
---

Add `additionalTargets`, and make the target wildcard work in both positions.

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
