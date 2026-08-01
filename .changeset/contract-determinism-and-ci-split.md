---
"@zintljs/testing": patch
---

Make contract assertions retry-capable and add a causal settle wait.

Every flaky contract traced back to the same shape:

```ts
await heading.waitFor({ state: "visible", timeout: 15000 });
expect(await heading.textContent()).toContain(expected);
```

`waitFor` resolves _immediately_ when the element is already visible showing the previous value, so the read races the update and the 15-second timeout never engages. It looks like waiting; it isn't. That produced `expected 'Memory Iteration 5' to contain 'Memory Iteration 6'` and `expected 'Hammer 4' to contain 'HMR Hammer works!'`.

- Adds `lab.assert.textEventually(selector, expected)`, which polls the live DOM and reports the last value it saw so a genuine stall stays diagnosable. Migrated every occurrence of the old shape.
- Adds `lab.waitForSettled()`, gating on the runtime's settle beacon rather than `networkidle` plus a fixed sleep. `LabFilesystem` gained a before-mutation hook so the baseline is captured _before_ the write it is waiting on, rather than racing it.
- `ZINTL_STRICT_SETTLE=1` turns a missing or stalled beacon into a hard failure instead of a silent fallback. A degraded signal and a working one are otherwise indistinguishable, which is what made the previous heuristic impossible to trust.

Also makes contract snapshots portable: bundler `#region` breadcrumbs for public-directory assets encode a `../` depth that tracks the absolute checkout path, so they differed between a local machine and a CI runner. Normalized to `<OUTSIDE_ROOT>/`, scoped to `#region` lines only — vendored sources legitimately contain relative paths that must not be rewritten.

The HMR performance budget is now relaxed under `CI`. Wall-clock timing on a shared runner measures the runner, not Zintl; a tight budget there only teaches everyone to ignore the suite.
