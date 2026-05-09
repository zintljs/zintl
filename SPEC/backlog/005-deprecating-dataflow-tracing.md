# 005-deprecating-dataflow-tracing

## View

Historically, the Zintl extractor operated under the philosophy that if a dynamic UI sync (e.g., `innerHTML` or `div.textContext`) received a variable, Zintl could aggressively reverse-trace the AST to discover where that variable was initialized and translate the string locally.

## Problem

In highly-composable architectures (React, Svelte, Lit), component trees frequently forward complex generic variables (dynamic strings, class names, configs, array nodes, and numeric identifiers).

Reverse-tracing proved to be overwhelmingly dangerous for simple deployments:

1. It attempted to translate generic dictionary lookups across API responses if passed directly to `divs`.
2. It conflicted architecturally with the implementation of **Intelligent Stitching**. Because both concepts competed for the `VariableDeclarator` space, generic variables failed logic assertions when the compiler forced `isUiSink` properties backwards down the syntax trees.
3. The extraction ruleset was considered "magical" by engineers because local code transformations occurred disconnected from their original injection sites (`{t('hash')}`) resulting in difficult-to-trace logic breaks inside large utility dependencies.

## Solution

We have deprecated deep dataflow backward tracing.

We will remove the `bindingsMap`, `uiSinkProperties`, and `aliases` caching out of the pipeline, stripping out thousands of loop evaluations to immediately streamline the bundle parse speed.

The engine's extraction policy is updated to simply target what the developer puts perfectly in the UI.

## Notes

A non-magical explicit wrapper `_('value')` may be investigated later if the problem naturally arises, but for now, "Zero code affection" handles templates seamlessly at injection rather than aggressively pre-translating.
