---
"@zintljs/testing": patch
---

The delivery contracts no longer assume how an app was chunked.

`delivery-ordering` and `delivery-refresh` found their probe boundary by scanning the store for the
one carrying the app's heading, and aborted when none did. That is really a claim that the asserted
string arrives in a _registered_ catalog rather than one the manager _inlines_ — and on an app whose
heading sits in the entry's own boundary, it does not hold. Both contracts aborted on a project where
delivery demonstrably works, which cost that project a capability it had already earned.

`pickDeliveryProbe` prefers the boundary carrying the heading, falls back to any registered one, and
fails only when the store holds no catalogs at all for the active locale. Axiom D1 and the push/pull
join are properties of the receiver rather than of any particular boundary, so this needs no
per-project answer — which is why it is a fallback rather than a new adapter field. When the fallback
fires, `carriesKey` records that the probe was a stand-in rather than hiding it.

`examples/rsbuild-vanilla-mpa` claims `hmr` as a result, measured at 0 failures in 10 runs across
`hmr`, `syntax-recovery` and the three delivery contracts. See ledger L-056.
