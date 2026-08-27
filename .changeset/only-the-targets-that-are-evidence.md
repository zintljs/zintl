---
"@zintljs/compiler": minor
---

Remove `obj:field:*` from the default extraction targets.

A default sink target must never catch text that is not user-facing. `obj:field:label` matched a field
name on **any object literal anywhere**, knowing nothing about the object:

```js
// what you wrote
export const analytics = { label: "signup_button_click" };

// what shipped
export const analytics = { label: _t("signup_button_click", …) };
```

Extraction rewrites the value, so in Arabic that event name came back in Arabic. And with no fallback
to the source locale, it also failed the build until somebody translated it. No curation of the field
list fixes that, because the name is the entire signal.

The capability did not go anywhere — it now says _which_ object it means:

```ts
const ui = { home: { title: "Welcome" } }; // obj:ui:title
defineConfig({ title: "My site" }); //        call:defineConfig:title

// @zintl-target
export default { title: "…" }; //             no name to point at
```

**`tag:html` is a new vanilla default**, and it is the answer for an app that builds its own HTML — the
common vanilla and SSR shape whose only working answer used to be _name the field `text`_. A tag cannot
fire by accident: the author has to write `` html`…` `` around the string. Lit already declared it.

**Next.js metadata is targeted rather than suppressed-and-bypassed.** `metadata` and `generateMetadata`
used to be suppressed with `bypassIf: "hasAnchor"`, so extraction depended on putting a `zintl()` call
inside the function. That happened to work for `generateMetadata`, and left the far more common static
`export const metadata = { … }` unreachable — no anchor, no strings, no message. `title` and
`description` are now named precisely, which also keeps `icons` and the Open Graph URLs out.

### Migrating

**Almost certainly nothing.** Measured across all 30 examples after the removal: every one extracts the
same strings as before. The two that depended on `obj:field:*` were migrated first, and their actual
strings — not just counts — were compared.

**Vue's Options API is the exception, and the only one.** Strings in a `data()` return are ordinary
object fields:

```vue
<script>
export default {
  data() {
    return { field: { label: "Save changes" } };
  },
};
</script>
```

`obj:<binding>:<field>` cannot reach that either: `data` is a property of the default-exported object,
not a declaration, so there is no binding to name. Mark it instead:

```diff
   data() {
+    // @zintl-target
     return { field: { label: "Save changes" } };
   },
```

If you were relying on object-field extraction elsewhere, `obj:*:label` restores the old behaviour
exactly — and now says out loud what it does.

**One cosmetic consequence of adopting `tag:html`.** A tagged template is markup the formatter can
see, so oxfmt will format the HTML inside it — `examples/vanilla-ssr` came back with its SVG and list
markup re-wrapped across lines. Extraction is unaffected (the same 15 strings, verified by content
rather than count), but it will show up in your diff the first time you migrate a template, and it is
better to expect it than to wonder.

See [proposal 033](../docs/spec/proposals/033-structural-defaults-and-declared-targets.md), §8.1 for the
measurement and §8.2 for the Vue case.
