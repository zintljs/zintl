---
"@zintljs/testing": patch
---

Make the catalog payload budget measure the bundle a user downloads.

`performance-size` asserted that lazily loaded translation chunks stay under a size budget, and
measured HTTP responses from the **dev server** — a budget its own comment conceded was "adjusted to
10KB to support Vite dev-mode wrapper overhead". Dev-wrapped modules bear no fixed relationship to
shipped bytes, the capture depended on a timing window that varied run to run (observed failing 1 in
7 while passing 3 of 3 in isolation), and its URL filter was four Vite-shaped fragments, one of them
any `.json`.

It now builds and weighs the emitted files: no page, no window, no URL. Catalog chunks are found by
**content** — the emitted file carrying a translation the project has on disk — because a path
pattern matching both Rollup's `assets/entry_b_<hash>.js` and Rspack's `static/js/async/<hash>.js`
matches nearly everything. Chunks measure 611–982 bytes against an 8 KB budget that guards a shape
rather than a target: a catalog holds one boundary's strings for one locale, so anything near the
limit means something else was pulled in.

0 failures in 10 runs, and 3 seconds per run against a version that booted a browser to drive a
locale switch.
