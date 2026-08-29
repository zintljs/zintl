# Translating

Where the catalogs are, who edits them, and what keeps them honest.

## Where they land

One file per source file, per locale, under `outputDir` — `zintl/` unless you change it:

```
zintl/
  src/
    App.vue.ar.json
    App.vue.fr.json
  .schemas/
    src/App.vue.schema.json
```

Splitting by source file is for the people editing them: a translator opening `Checkout.vue.fr.json` sees one screen's worth of strings, not the whole product. It has nothing to do with how catalogs are chunked for the browser — that follows your import graph, not your directory tree.

There is no file for your source language. It is never written, because the compiler already holds those strings and a file of `{"key": "key"}` is a maintenance burden pretending to be data.

## The schema beside them

Each catalog points at a generated JSON Schema, so an editor with schema support gives translators autocomplete, validation, and — where you left a [`@zintl-note`](/reference/comment-directives) — the note explaining what the string means.

That is worth more than it sounds. "Open" is a verb or an adjective depending on the screen, and a translator with no context has to guess.

## Editing them

They are plain JSON. Fill in the values:

```json
{
  "Welcome back!": "¡Bienvenido de nuevo!",
  "Settings": "Ajustes"
}
```

Anything you leave empty fails the build. That is the point.

## When the source changes

Edit an English string and its translations follow it, as long as the two are recognisably the same sentence. Zintl compares the old and new text and carries the translation across when they are close enough — `similarityThreshold` decides how close, and lowering it is more forgiving.

Move the file, rename the component, restructure the directory: nothing is lost. Identity is content-based, not path-based, so translations are attached to the words rather than to where the words lived.

Delete a string and its entries are removed, unless you turn `prune` off.

## Sending them somewhere else

Catalogs are JSON, so most tooling can read them directly. Where a translation system wants XLIFF, Zintl exports and imports it — carrying the context the graph knows about each string, which a bare key-value export throws away.

> [!NOTE]
> An import is a gate, not a merge: what comes back is checked against what the compiler knows, rather than trusted and written over the top.

## Localized assets

Some content is not a string in a component — a page of prose, a diagram, a PDF. Files matching `assetsTarget` (`.md` and `.txt` by default) are **authored per locale** rather than translated into existence: Zintl writes an empty artifact beside your catalogs and waits for you to fill it.

It never copies the source across, because an English PDF at the German path is not a German PDF, and a byte-identical file is a fallback that nothing downstream can detect.

If a file is the same in every language, do not target it. That is all targeting means.

## Next

| To                  | Read                                                     |
| :------------------ | :------------------------------------------------------- |
| Understand chunking | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
| See every option    | [Configuration](/reference/configuration)                |
