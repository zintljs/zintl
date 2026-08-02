# Zintl Comment Directives (ZCD)

**Version**: 1.0  
**Status**: Active

---

## §1 — The Directive Philosophy

Directives are non-executable instructions embedded in source code comments (`//`, `/* */`, or `<!-- -->`). They provide a side-channel for developers to control the **Zintl Extractor** without modifying the application's runtime behavior.

ZCD adheres to the **Surgical Precision** principle: a directive should only affect its intended target and never "bleed" into unrelated siblings or parent scopes unless explicitly designed for subtree suppression.

---

## §2 — Standard Directive Set

| Directive                | Scope        | Purpose                                                                        |
| :----------------------- | :----------- | :----------------------------------------------------------------------------- |
| **`@zintl-ignore`**      | Node/Sibling | Suppresses extraction for the immediate next node or sibling.                  |
| **`@zintl-ignore-file`** | File         | Disables Zintl extraction for the entire source file.                          |
| **`@zintl-note`**        | Node         | Provides persistent context for translators, injected into the catalog schema. |
| **`@zintl-pass`**        | Node         | Binds invisible context variables (e.g. gender, role) to a stitched unit.      |

---

## §3 — Proximity & Attachment Heuristics

To ensure directives are applied surgically, the extractor follows a strict **Gap-Axiom**:

> [!IMPORTANT]
> A directive is only "attached" to a node if the source code gap between the comment and the node contains **zero significant characters** (only whitespace, newlines, or JSX brace markers `{}`).

### §3.1 — The Newline Limit

Directives are typically placed on the same line or the immediately preceding line. A gap of more than **one newline** between the comment and the node results in a "Detached" state, where the directive is ignored.

---

## §4 — Scoping Mechanics

### §4.1 — Subtree Suppression (Recursive)

When a directive is applied to a container node (e.g., `JSXElement`, `FunctionDeclaration`, `VariableDeclaration`), it triggers a **Suppression State**.

- All children and nested expressions within that container's AST subtree are automatically bypassed.
- This is implemented via the `suppressionLevel` counter in the `ExtractionContext`.

### §4.2 — Sibling Suppression (Surgical)

In JSX children or template literal fragments, a directive often appears as a sibling:

```jsx
<div>
  {/* @zintl-ignore */}
  <span>Hidden</span>
  <span>Visible</span>
</div>
```

In this scenario, Zintl applies **Surgical Muting**:

1. The extractor identifies the directive container.
2. It marks **only the next non-whitespace sibling** as "handled".
3. Subsequent siblings remain visible to the extractor.
4. For HTML fragments in template literals, `@zintl-ignore` scopes to the next tag and its nested subtree, using an internal tag-stack to detect the closing boundary.

### §4.3 — HTML Fragment Scoping (Stack-Based)

In template literals containing HTML-like structures, directives use a **Closing-Tag Heuristic**:

- `<!-- @zintl-ignore -->` suppresses the immediate next tag and all its children.
- Suppression ends only when the corresponding closing tag is encountered.
- Self-closing tags (`<br/>`) or void elements (`<img>`) are correctly handled to prevent "infinite ignore" scenarios.
- Directives like `@zintl-note` and `@zintl-pass` within a fragment are **one-shot**: they only apply to the immediate next text segment and are surgically reset afterwards to prevent contamination of sibling fragments.

## §5 — Context Injection (@zintl-pass)

`@zintl-pass` allows developers to provide variables to the translator that are not physically present in the extracted string. This is vital for **Target-Language Asymmetry** (e.g., pluralization or gender logic in Arabic/French that isn't needed in English).

**Syntax**:

```javascript
// @zintl-pass gender="female" role={user.role}
```

The variables are extracted and injected into the catalog's `$schema`, ensuring translators have the necessary context to write ICU MessageFormat logic.

---

## §6 — File-Level Governance

The `@zintl-ignore-file` directive must be placed at the top of the file (before any translatable sinks). Once detected, the extractor aborts processing for that file immediately, resulting in zero overhead for ignored assets.

---
