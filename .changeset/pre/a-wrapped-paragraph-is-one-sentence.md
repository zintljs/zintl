---
"@zintljs/extractor": minor
---

Collapse the whitespace HTML collapses, before markup text becomes a key.

A paragraph wrapped across lines in an HTML document or an SFC template was extracted with the
author's newlines and indentation intact, so this

```html
<p>Released under the MIT licence, and every word of it was extracted from plain source.</p>
```

became the key `"…every word of it\n          was extracted from plain source."` — one sentence to
every renderer that will ever draw it, and two lines to the compiler.

That is wrong twice. As a **key** it ties translation identity to formatting: reindent the file, or
let a formatter rewrap the paragraph, and the key moves and its translation is orphaned. Content-based
identity exists precisely so that moving code does not cost a day of reconciling catalogs, and this
was a way to lose translations by running `vp fmt`. As **emitted code** the newline lands inside the
quoted literal codegen writes, and a raw newline in a JavaScript string is a syntax error — in a Vue
SFC it takes the whole component down with it, which is how it was found.

JSX already normalized (`jsx.ts` has collapsed whitespace since it was written); the HTML and SFC
path, which shares one stitcher, never did. It does now, with `<pre>`, `<textarea>`, `<script>` and
`<style>` excepted — the four places the HTML specification says a run of whitespace is content.
Fragment offsets are still measured against the original text, because a fragment occupies the same
span of source whatever its text collapses to.

**Keys move for any project with markup prose wrapped across lines**, and three examples here had
some. Every translation survived: reconciliation matched each cleaned key to its old one and carried
the value across, so the diff is thirteen keys changed and thirteen values preserved. Worth a look at
your catalogs after upgrading all the same.
