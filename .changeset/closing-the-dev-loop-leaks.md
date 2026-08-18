---
"@zintljs/compiler": patch
"@zintljs/testing": patch
"zintljs": patch
---

Fix the dev HMR snippet corrupting any module with `</script>` in a string, and close three
dev-loop leaks from proposal 027's ledger.

**The product defect (L-073).** In dev, the HMR snippet was spliced before the file's _last_
`</script>`. That rule exists for SFCs, whose module code lives inside a script block — but it was
applied to every file, so in a plain module it found whatever the source happened to contain. A
server entry building its own document (`'<head>' + '<script src="/@vite/client"></script>' +
'</head>'`, which is what any SSR shell does) had the snippet spliced into the middle of the string.
The module then failed the bundler's import analysis and the app served a 500 on **every request** —
dev only, with a clean build, and with an error message pointing at the bundler rather than at
Zintl. Where a file may legally hold injected code is now asked of the codegen facets rather than
read out of the text, so a project with no SFC facet cannot take that branch at all.

**Write attribution (L-071).** A flush has five independent reasons to write a catalog and the write
could not say which applied. Each producer now tags what it schedules, and the tag reaches both the
debug log and the `io/write` envelope. That immediately named the writer that had survived four
investigations: an observation already in flight re-registers a boundary `removeFile` has forgotten,
so the next flush writes back the catalogs the prune just reclaimed. The mechanism is now stated and
observable; the fix it suggests was measured and did not earn its place, so it is not here.

**Harness (L-066).** `catalogContains` now waits on the compiler's dirty set before reading, reads
through merged catalogs instead of comparing an object to a string, and takes an optional `value` so
"a translator can find this key" is expressible. It had never been called, and could only ever have
failed on the two merged-catalog projects. With it, `hmr-growth` asserts again that a new sink
reaches disk — 0 failures in 10 runs, including the project the ledger recorded as never writing the
key at all.

**SSR examples.** All four `*-ssr` examples now hand their http server to Vite
(`hmr: { server }`). In middleware mode Vite otherwise opens its HMR socket on a fixed port, so a
second SSR app on the same machine silently receives no hot updates at all. This is what had made
`react-ssr` unable to hot-update; it, and the three SSR examples that had never claimed the
capability, now do.
