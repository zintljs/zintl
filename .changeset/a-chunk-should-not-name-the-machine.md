---
"zintljs": patch
---

Stop publishing the build machine's filesystem in a chunk name.

A localized asset's module id is base64-encoded, and deliberately so: an id that still ends in `.md`
gets typed by its extension, and Rspack then base64s the JavaScript we return into a `data:` URI —
a green build that ships a URI where the translation belongs (ledger L-009). That part is unchanged.

What was wrong is _what_ got encoded. The id becomes the emitted chunk's name, so encoding the
absolute path put the author's home directory into a public artifact:

```
assets/L1VzZXJzL2toYWxpZC9MaW5ndWEvbGluZ3VhL2V4YW1wbGVzL3dlYnNpdGUvc3JjL2NvbnRlbnQv….js
```

which decodes to `/Users/khalid/…/src/content/what-is-zintl.md?raw`. Anyone with a base64 decoder
had the path it was built from.

The path is now encoded relative to the project root — `src/content/what-is-zintl.md?raw` — which
keeps every property the design depends on (opaque, extension-free, unique within the project, a
pure function of its input) and drops the filename from 94 characters to 55. A file outside the root
encodes as `../…` and round-trips unchanged.

The four sites that encoded and decoded this by hand now share one codec, which is where the
reasoning lives.
