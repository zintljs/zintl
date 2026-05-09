# Proposal 001: Streaming-Aware Macro Expansion & The Vanishing Runtime

## Status: Draft

**Author**: Zintl AI Architect
**Date**: 2026-04-08

## 1. Abstract

Currently, Zintl uses a "Smart Manager" at runtime to load catalogs asynchronously or via synchronous boost. While highly performant, it still involves a runtime footprint on the client.

This proposal describes a shift toward **Streaming-Aware Macro Expansion**, where the Zintl compiler identifies **Server-Only Boundaries** (RSC) and **Interactive Boundaries** (Client Components). For Server-Only parts, translations are "baked" directly into the HTML stream, achieving **Zero CLS** and eliminating the client-side runtime for those sections.

## 2. Motivation

- **Eliminate i18n Logic from the App**: Developers should write one set of code; the build system should determine how it is internationalized based on the environment (Server vs. Client).
- **Maximize Performance (Zero CLS)**: Lazy-loading translations on the client causes Cumulative Layout Shift. Inlining translations in the server stream solves this at the source.
- **Reduce Codebase**: For static or server-rendered pages, no Zintl runtime (`t`, `zintl`, `subscribe`) should ever reach the user's browser.

## 3. Core Concepts

### A. The Hybrid Boundary Graph

We extend the existing Boundary Graph to track the **Execution Environment**:

- **Static Boundary**: Never changes locale on the client.
- **Dynamic Boundary**: Can switch locales (e.g., via a language toggle) without a full page reload.

### B. Server-Side Direct Injection (RSC)

When the compiler detects a `zintl()` macro in a Server Component:

1. It resolves the `locale` during the render cycle.
2. It replaces `${"Message"}` with the actual translated string `Translated Message`.
3. The client receives static HTML. No `t()` function call remains in the code.

### C. The Selective "Smart Manager"

The Smart Manager is only shipped for **Dynamic Boundaries**. If an entire page is static, no Manager is generated. If only a small "Island" is dynamic, only that island gets a small localized Manager.

## 4. Implementation Strategy

### Phase 1: Environment Detection

Update `@zintl/compiler` to identify if the current file/boundary is a Server Component or a Client Component (using the `"use client"` directive or framework-specific markers).

### Phase 2: Literal Replacement (The "Baking" Step)

For Static/Server boundaries, the compiler performs a hard replacement of translatable units.

- **Source**: `<h1>${"Welcome"}</h1>`
- **Output (AR)**: `<h1>مرحبا</h1>`

### Phase 3: Manifest-Driven Streaming

The Vite plugin/Compiler informs the SSR engine which CSS and Catalog chunks are needed for the current route. For frameworks like Next.js or Vite-SSR, we provide a hook to push the required translations into the initial `<head>` or the start of the stream.

## 5. Benefits

- **Zero CLS**: Translations are part of the initial HTML payload.
- **Micro-Bundle Size**: Moving from a ~3KB runtime to potentially 0KB for many pages.
- **Invisible i18n**: The developer focuses entirely on the UI and logic; Zintl handles the heavy lifting of delivery across the server-client boundary.

## 6. Open Questions

- **Locale Context Propagation**: How do we pass the "Active Locale" from the server to the nested client components without re-triggering a `zintl()` call?
- **Hydration Mismatch**: How do we ensure that if a client component hydrates, it doesn't "reset" the string baked into the server HTML if it doesn't have the catalog yet?

---

> [!TIP]
> This proposal directly supports the vision of eliminating i18n logic from the web app codebase, allowing the compiler to manage the "where" and "how" of translation delivery.
