---
"@zintljs/testing": patch
---

Strengthen the contract suite, and stop one contract claiming coverage it does not have.

**Two new contracts, both asserting in a real browser.** The distinction matters more than it sounds: the runtime is served as _text-substituted source_ through `getRuntimeCode`, and the one time a guard could not be folded, every development branch in the browser was dead for the project's entire life while every unit test passed. A rule that only holds against a bare `I18nStore` is not a rule that holds.

- **Delivery Ordering** proves Axiom D1 the way `hmr-hammer` cannot. `hmr-hammer` can only observe the order the network happened to produce; it can never make an older catalog arrive _after_ a newer one. This one does, and asserts the older loses — and that it loses _by rule_, with the supersession recorded, since a correct result reached by accident is indistinguishable from one reached by rule and does not survive the next change. It asserts on the store rather than the DOM, deliberately: whether a framework re-renders is a different question with its own contracts, and asserting it here would report their failures as ordering failures.
- **Delivery Failure** is proposal 024's acceptance criterion 2 — an abandoned boundary is observable. It exercises all three abandonment paths (rejection, empty result, synchronous throw) and requires each to be named in the ledger _with a reason_, because "it failed" and "it resolved empty" call for different fixes. It also asserts the page survives: a failed lazy boundary is not a crash.

**`assert.localeCoherent()`** checks that the store and the document agree about the locale. `assert.locale()` only ever read `html[lang]`, so a page rendering Arabic while announcing English passed it — which is precisely the defect a superseded locale switch produced when it was still allowed to publish. Both halves were individually plausible; only their disagreement was the bug. Wired into `locale-switch` and `locale-storm`.

**A contract can now declare itself `pending`.** `chaos-boundary` had its entire body commented out behind a known blocker, so what it actually ran was `navigateHome` plus one heading assertion — an exact duplicate of `initial-render`, reporting green and claiming the `chaos` capability while covering none of it. That is the worst state a test can be in: it occupies the slot where the real coverage would go and tells everyone the slot is filled. It is now skipped with its reason in the test report. A visible gap beats a passing test that hides one.

**One assertion was written, measured, and removed** — worth recording because it looked rigorous and was wrong. `hmr-hammer` briefly asserted that the wire carried one packet per write. It failed on every project: 3 packets for 5 writes, consistently, while the DOM converged correctly every time. The conclusion is not that delivery is broken but that the invariant was false. **Coalescing rapid writes is correct** — two writes 30 ms apart may legitimately become one event, provided it carries the later content. Proposal 024 §1.1a is narrower than "fewer packets than writes": it is coalescing dropping the **final** state. That is what the convergence assertion already tests, and counting packets would only add a red that means nothing.

Suite: 76 contract tests (from 72), still ~73–82 s.
