# Comment directives

Zintl extracts strings automatically, which is right almost all of the time. Directives are for the rest — written as ordinary comments (`//`, `/* */`, or `<!-- -->`), so they travel with the code they describe and disappear at build time.

## `@zintl-ignore`

Skip the next node, and everything nested inside it.

```jsx
<div>
  {/* @zintl-ignore */}
  <span>SKU-40021</span>
  <span>Add to cart</span>
</div>
```

`SKU-40021` is never extracted; `Add to cart` is.

Reach for this when a string looks like prose but isn't: product codes, brand names, debug output, or a language switcher whose labels are deliberately written in their own language.

## `@zintl-note`

Leave a note for whoever translates the string. It lands in the generated JSON schema, so translators see it in their editor rather than having to guess from the string alone.

```ts
// @zintl-note Shown on the dashboard right after login
const welcomeMsg = `Hello again!`;
```

Worth writing whenever the source string is ambiguous out of context. "Open" is a verb or an adjective depending on the screen, and a translator with no note has to pick one.

## `@zintl-pass`

Give a translation access to a value your source text doesn't mention.

```ts
// @zintl-pass role={user.role}
const dashboardTitle = `Welcome to your dashboard!`;
```

English needs nothing here. Other languages might need the user's gender, role, or count to choose the right words — grammatical distinctions English simply doesn't make.

`@zintl-pass` binds those values invisibly: your source stays exactly as it reads, the variable appears in the generated schema, and translators can branch on it with ordinary [plural or select syntax](icu.md). Nothing about your runtime logic changes.

This is the escape hatch for the fact that **target languages often need more context than the source has**. Without it, the usual workaround is to contort the English so a translator has something to hook onto — which makes your source worse to serve a language it isn't written in.
