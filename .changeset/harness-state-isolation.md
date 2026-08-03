---
"@zintljs/compiler": patch
---

Stop contract runs writing into the committed examples, and add an SSR isolation contract.

**The per-worker copy was not actually isolated.** `copiedExampleSource` reproduces `node_modules` as a symlink farm that skipped `.vite`, `.cache` and `.vite-temp` — but not `.zintl`, which holds the compiler's persisted manifest. The copy and the real example therefore shared one, and the consequence escaped the test run entirely: a contract that renamed a file wrote a phantom boundary into four examples' manifests, and the next `build:examples` read it back and generated catalogs for source that did not exist — twelve untracked JSON files in the tracked `examples/` tree, from one contract.

`.zintl` is now **copied** per worker rather than linked. Omitting it was tried first and is wrong for a reason worth recording: a compiler starting cold resolves boundary ownership differently from one reading a saved manifest — `src/App.tsx:App` moved from `src/main.tsx:bootstrap` to an anonymous `src/main.tsx:f_547`, changing four committed graph snapshots. That difference deserves its own investigation, since ZRS Axiom 4 says ownership is deterministic; it is not the copy helper's job to absorb. Copying gives every worker the same warm starting state with no shared mutable file, which is the property the copy exists to provide. Verified by running the offending contract live and confirming `examples/` stays clean.

This is the same failure the `.vite` comment two lines above already warned about, missed for the same reason it gives: module resolution keeps working perfectly while the state underneath is shared, so nothing looks wrong until an artifact outlives the run that produced it.

**A new SSR request-isolation contract — marked `pending`, because it was falsified.** The store is request-scoped through `AsyncLocalStorage`, but `getActiveInstance` falls back to the process-global `globalThis.__zintl_active`, and every existing SSR contract issues one request at a time — precisely the condition under which that fallback is indistinguishable from the correct path.

The contract captures each locale uncontended, then interleaves them and requires every response to still match its own baseline. It passes. To find out whether that meant anything, request scoping was deliberately broken by disabling the `AsyncLocalStorage` lookup; the sabotage reached the served runtime (verified in `dist/runtime/store-core.mjs`, where the bundler had folded the branch away) and **the contract still passed**.

The reason is the example, not the contract: `react-ssr` renders with `renderToString`, which is synchronous. There is no await between entering the request scope and finishing the render, so no second request can interleave and observe the global. The leak is unreachable here by construction.

So it ships `pending` rather than green. The assertions and the baseline-then-interleave method are right; what is missing is a **streaming** SSR project — `renderToPipeableStream` with `injectIntoStream`, which the `streamInjection` capability and `store-server.ts` already exist to serve. One fixture away, and then one deleted line.
