---
"@zintljs/compiler": patch
---

Hot updates on Rspack no longer render new source against an old catalog.

Editing a translatable string in a boundary the entry does not own left the page blank for that
string: the reloaded page re-executed with the **new** message key while the catalog it read still
held the old one, and Zintl has no source-locale fallback by design, so the element rendered empty and
nothing repaired it. Measured directly rather than inferred — after an edit, the dev server served a
**byte-identical** manager chunk and a byte-identical content chunk, while the source module and the
catalog files on disk had both updated correctly.

Two independent faults in the same declaration, and either alone was enough:

- The catalog dependency was built from a **safe** boundary id (`b_src_pages_Home_Home`) where
  `getCatalogPath` expects a **normalized** one (`src/pages/Home:Home`), so it named
  `<outputDir>/b_src_pages_Home_Home.<locale>.json` — a file no flush will ever write. Rspack accepted
  the dependency, found nothing, and the generated module was never stale. The same two-kinds-of-string
  confusion as ledger L-026, one layer along.
- A chunk declared inputs only for the boundary it is _named after_, while embedding the catalogs of
  every boundary it contains. An entry chunk carrying a component's catalog never watched that
  component's source.

Generated content and manager modules now declare the inputs of every boundary they embed, and the
declaration is unioned with what that module has declared before — a boundary that drops out while its
file has a syntax error must still be able to come back, and deriving the watch set from current
contents alone would have stopped watching the file whose repair returns it.

Vite is unaffected by construction: these declarations are gated on `dependencyInvalidation`, which
only Rspack declares. See ledger L-057.
