# 004-commit-to-intelligent-stitching

## View

We recently implemented **Intelligent Stitching**, which natively stitches dynamic variables in Template Literals and React UI trees straight into dynamically evaluated compiler references (e.g. `"Welcome {name}"`).

Simultaneously, the compiler currently possesses a feature called **Dataflow Tracing**. Dataflow tracing analyzes variables backwards up the syntax tree to find exactly where their literal value was injected, in an attempt to automatically wrap non-UI literals in translations before they ever reach the UI.

## Problem

In practice, these two philosophies conflict on a fundamental lexical level. If a developer provides a variable representing a string into a dynamic view logic branch:

```javascript
const mainTitle = "Vite + TypeScript";
<p>${mainTitle}</p>;
```

The architecture forces a panic regarding two mutually-exclusive execution paths:

1. Do we trace `mainTitle` backwards to its constant `"Vite + TypeScript"`, extract `"Vite + TypeScript"` into the manifest, and translate it there? (Dataflow Tracing)
2. Or do we immediately extract `"{mainTitle}"`, executing it precisely at the injection site as `t("hashcode", { mainTitle: mainTitle })`? (Intelligent Stitching)

The issue is that the compiler has zero objective indication of whether the string assigned to `mainTitle` is natively _translatable_, or if it's an immutable dynamic parameter like an API-provided `ID` or user handle, in which case dataflow mapping generates untranslatable JSON gibberish.

## Solution

We are fully decoupling translation dataflow mapping logic from normal reference evaluations.

1. We are **deprecating** the deep variable traces ("Dataflow Tracing"). The compiler will no longer auto-magically reverse variables upwards.
2. We are officially **Committing to Intelligent Stitching**. Every literal parsed via JSX UI trees or template literals natively treats nested references as isolated runtime parameters (`{name}`).

This guarantees entirely deterministic extractions cleanly coupled to the UI injection point.

## Notes

A macro-function mechanism (like `const mainTitle = t("Vite")` or `i18n("Vite")`) will likely need to be offered in the future for scenarios where non-UI variable data natively must be statically tracked across local code.
