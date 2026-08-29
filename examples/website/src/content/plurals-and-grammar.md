# Plurals and grammar

English has two plural forms. Arabic has six. Your source code should not have to know that.

## The problem, stated once

```ts
const label = `${count} items`;
```

This is wrong in most languages, and the usual fixes make your source worse: a ternary that only handles two cases, or a `t()` call with a `count` argument and a key you now have to name.

## What Zintl does instead

You write the sentence. Translators write the grammar, in the catalog, using ICU syntax:

```json
{
  "{count} items": "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}"
}
```

Your source keeps saying `${count} items`. The Arabic catalog carries six forms because Arabic has six, and the English one carries none because English needs none. Grammatical complexity lives where the grammar does.

## It compiles away

That ICU string is not parsed in the browser. At build time it becomes a plain JavaScript function:

```js
(params) => {
  const { count } = params;
  if (count === 0) return "لا عناصر";
  if (count === 1) return "عنصر واحد";
  // …
};
```

No message-format library reaches your users. A grammar engine that ships to every visitor to handle a rule that was known at build time is exactly the kind of weight this project exists to remove.

## Choosing between wordings

`select` works the same way, for anything that is not a count:

```json
{
  "Invite them": "{gender, select, male {Invítalo} female {Invítala} other {Invítale}}"
}
```

## When the source has no such word

Spanish needs to know a gender your English sentence never mentioned. Rather than contorting the English to give the translator something to hook onto, pass the value invisibly:

```ts
// @zintl-pass gender={user.gender}
const invite = `Invite them`;
```

The source reads exactly as it did. `gender` appears in the generated schema, and translators can branch on it.

> [!NOTE]
> This is the escape hatch for the fact that target languages often need more context than the source has. Without it, the usual workaround is to make your English worse to serve a language it is not written in.

## Numbers, dates and currency

Those are `Intl`'s job, and `Intl` is in the browser already. Zintl does not wrap it.

## Next

| To                     | Read                                                     |
| :--------------------- | :------------------------------------------------------- |
| Steer the compiler     | [Comment directives](/reference/comment-directives)      |
| See how catalogs split | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
