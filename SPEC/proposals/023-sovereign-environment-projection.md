# ZRS-023: Sovereign Environment Projection (Global Context Handshake)

## Status: PROPOSAL

**Author**: Antigravity (God-Tier Architect)
**Date**: 2026-05-09

---

## 1. The Challenge: The Federated Blind Spot

The **Sovereign Anchor** (`zintl("*")`) currently operates under a "Closed-World Assumption." The compiler knows every reachable boundary at build-time and fans them out into locale-perfect, zero-runtime assets.

However, in **Micro-Frontend (MFE)** architectures or **Federated Module** scenarios:

1.  **MFE-A (Host)** is a Sovereign Kingdom built to `/ar/`.
2.  **MFE-B (Remote)** is an external module built separately.
3.  When MFE-A imports MFE-B at runtime, MFE-B has no built-in knowledge of MFE-A's active locale because they were never part of the same boundary graph.

Without a shared signal, the remote MFE-B will fallback to the `sourceLocale` (e.g., English), creating a "Translation Mismatch" in the UI.

---

## 2. The Proposal: Sovereign Projection

We propose that every Sovereign Root, upon baking, **projects its authority** into the global execution environment. This turns a "Private Build Fact" into a "Public Environment Signal."

### 2.1. The Declaration Mechanism

When the compiler bakes a Sovereign Root for a specific locale (e.g., `ar`), it injects a lightweight **Environment Declaration** into the HTML (via `transformHtml`) or the entry script:

```html
<!-- Injected by Zintl Sovereign Transformer -->
<script id="zintl-env-projection">
  globalThis.__ZINTL_LOCALE__ = "ar";
</script>
```

### 2.2. The Consumer Handshake (Contextual Fallback)

The Zintl Runtime (and separately compiled Colonies) will be updated to respect this global signal as the **Primal Contextual Anchor**.

When a `loadI18nInstance` call or a contextual `zintl()` anchor is executed:

1.  Check for an explicit parent anchor (Kingdom Manager).
2.  **NEW**: If no parent anchor is found, check `globalThis.__ZINTL_LOCALE__`.
3.  If found, use that locale for hydration and asset resolution.
4.  Fallback to `sourceLocale` only if both are missing.

---

## 3. The Impact: Zero-Config Federated Baking

This allows **Federated Sovereignty**:

1.  **Build Phase**: All teams build their MFEs as Sovereign (`zintl("*")`). Each team produces `/en/`, `/ar/`, etc.
2.  **Runtime Phase**: The Shell (MFE-A) loads in `/ar/`. It sets the global signal.
3.  **Federation Phase**: When the Shell imports MFE-B, MFE-B's loader reads the global signal and automatically fetches its own `/ar/` chunks instead of its `/en/` chunks.

### Benefits:

- **Zero Runtime Overhead**: No complex event emitters or state management. Just a single string in the global scope.
- **Cross-Team Alignment**: Separately built teams stay in sync automatically.
- **Micro-Frontend Native**: Perfectly aligns with the "Kingdom-Colony" philosophy, extending it across build boundaries.

---

## 4. Implementation Plan (Sketch)

1.  **Compiler**: Update `transformHtml` to inject the `<script>` tag when a sovereign anchor is detected in production.
2.  **Compiler**: Update `ZintlCompiler.transform` to optionally inject the global assignment at the top of the entry script if it's a fanned-out entry.
3.  **Runtime**: Update `loadI18nInstance` and the `ContextManager` to prioritize the global signal as a fallback.

---

## 5. Mantra

_The Kingdom declares its name, the foreigners obey the law, Empire!_
