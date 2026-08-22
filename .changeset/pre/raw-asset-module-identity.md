---
"zintljs": patch
---

Fixed localized text assets shipping a `data:` URI instead of their translation on bundlers that type modules by file extension.

Zintl turns a `.md`/`.txt` import carrying `?raw` or `?zintl-raw` into a JavaScript module, but kept the source path as the module id — so the module still looked like a text file. On Rollup and Vite that is harmless, because module type follows from _who loaded the module_. On Rspack it is a property of the resource's extension, decided before any plugin speaks: it classified `about.txt?raw` as an asset and base64-encoded the JavaScript into a `data:text/plain` URI, which the catalog then shipped where the translated text belonged. The build succeeded and every contract passed.

These ids now resolve to an extension-free virtual id, decoded again at load so every existing branch is unchanged. The fix is in id spelling — the plugin's own responsibility — rather than in a bundler-specific escape hatch that rewrote module rules.

Two boundaries worth knowing:

- The encoding is base64url, not `encodeURIComponent`. Percent-encoding preserves `.`, so the encoded id still ended in `.txt`, and unplugin materialises a virtual module as a real file whose _name_ is that id — reproducing the same misclassification one layer down.
- The rewrite is applied _after_ multiplex resolution picks a per-locale file, not before it. Rewriting the identity first short-circuits that choice and hands every locale the source text.

The encoding covers the whole id, query included, so decoding reproduces byte-identical input. That is what lets the same rewrite be applied at each of the five places resolution can land on such a file without any downstream branch knowing it happened.

No change to Vite output.
