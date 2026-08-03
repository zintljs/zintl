---
"@zintljs/compiler": patch
---

Add a streaming SSR fixture, and turn the request-isolation contract from unfalsifiable to proven.

`ssr-isolation` shipped `pending` because it could not fail. Every SSR project in the manifest renders synchronously, which leaves no window between entering the request scope and reading the store — so a request-scoped read and a read of the process-global `globalThis.__zintl_active` are indistinguishable, and the contract would have passed no matter what the runtime did.

The new `ssr-streaming` fixture supplies the two properties nothing else had:

- **An `await` inside the render.** One yield between entering the scope and producing translated output, which is the window a second request needs in order to observe the first's state.
- **A `ReadableStream` return.** `injectBakedCatalogs` routes that through `injectIntoStream` — machinery that ships in every SSR build and had no test touching it at all.

**Verified by falsification.** With the `AsyncLocalStorage` lookup in `getActiveInstance` deliberately disabled so every read fell through to the process-global, the contract failed on the fixture with **18 of 24 concurrent responses serving Arabic to English, Spanish and Chinese requests** — each one complete, well-formed, and belonging to somebody else. The four example projects kept passing throughout, correctly: they render synchronously and genuinely cannot leak. That split is the evidence the fixture was needed, and `ssr-isolation` is no longer `pending`.

Two things about the fixture are load-bearing and easy to get wrong. Its translatable strings sit in a **template literal carrying markup**, because that is what the extractor stitches — an earlier version passed the same text as a bare argument to `encoder.encode()` and produced no catalogs whatsoever, so the contract "passed" against a page with nothing to translate. And they are built **after** the yield, since that is where a contaminated read would occur; constructing them earlier would make the fixture look like it exercised the window while proving nothing.

Translations are seeded per locale so the four render visibly differently. The contract already refuses to run against identical baselines — a leak between locales that look the same is undetectable, and a test that cannot distinguish them should say so rather than report green.

Suite: 100 contract tests, ~72–74 s.
