# Comment directives

Zintl extracts automatically, which is right almost all of the time. Directives are for the rest.

They are ordinary comments — `//`, `/* */` or `<!-- -->` — so they travel with the code they describe and disappear at build time.

## `@zintl-ignore`

Skip the next node, and everything inside it.

```jsx
<div>
  {/* @zintl-ignore */}
  <span>SKU-40021</span>
  <span>Add to cart</span>
</div>
```

`SKU-40021` is never extracted; `Add to cart` is.

Reach for this when a string looks like prose but is not: product codes, brand names, debug output, or a language switcher whose labels are deliberately written in their own language.

## `@zintl-target`

The opposite: extract every string in the next node, whatever its fields are called.

```ts
// @zintl-target
export default {
  title: "Zintl — compile-time i18n",
  description: "Write your app in plain language.",
};
```

Zintl finds strings by where they appear — in markup, in an `alt`, assigned to `textContent`. An ordinary object is not one of those places, and it cannot be: `{ label: "…" }` is as often an analytics event as a button.

Use this when there is no name to point at, or you would rather not depend on one — an anonymous `export default`, an object passed straight into a call, or anything you want to stay extracted after somebody renames the variable.

Inside a marked node **every** string field is taken, including nested ones. `@zintl-ignore` still applies inside, so the two compose:

```ts
// @zintl-target
const meta = {
  title: "Checkout",
  // @zintl-ignore
  icon: "/favicon.svg",
};
```

## `@zintl-note`

Leave a note for whoever translates the string. It lands in the generated schema, so translators see it in their editor rather than guessing from the string alone.

```ts
// @zintl-note Shown on the dashboard right after login
const welcomeMsg = `Hello again!`;
```

Worth writing whenever the source is ambiguous out of context. "Open" is a verb or an adjective depending on the screen.

## `@zintl-pass`

Give a translation access to a value your source text does not mention.

```ts
// @zintl-pass role={user.role}
const dashboardTitle = `Welcome to your dashboard!`;
```

English needs nothing here. Other languages might need the user's gender, role or count to choose the right words — distinctions English simply does not make.

The value binds invisibly: your source stays exactly as it reads, the variable appears in the generated schema, and translators can branch on it with ordinary [plural or select syntax](/guide/plurals-and-grammar). Nothing about your runtime logic changes.

> [!NOTE]
> This is the escape hatch for the fact that target languages often need more context than the source has. Without it, the usual workaround is to contort the English to give a translator something to hook onto — which makes your source worse to serve a language it is not written in.

## Next

| To                | Read                                              |
| :---------------- | :------------------------------------------------ |
| See every option  | [Configuration](/reference/configuration)         |
| Get plurals right | [Plurals and grammar](/guide/plurals-and-grammar) |
