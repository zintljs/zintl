# Feature Backlog: Comment Directives

## Overview

As the Zintl compiler moved heavily toward robust `Intelligent Stitching`, an explicit need arose to allow developers an out-of-band "escape hatch." This allows them to manually annotate extraction behaviors without polluting runtime logic or writing explicit function markers (like `t("...")`). The **Comment Directives** system provides this functionality through Babel comment parsing.

## Implemented Directives

### 1. `@zintl-note`

- **Syntax**: `/* @zintl-note Context for the translator */`
- **Purpose**: Attaches descriptive notes meant to help human translators understand the meaning, tone, or specific placement of a string.
- **Scope**: Valid on Variable Declarations, Object Properties, and JSX Elements.

### 2. `@zintl-pass`

- **Syntax**: `/* @zintl-pass gender={user.gender} role="{role}" */`
- **Purpose**: Force-injects context variables directly into the translation replacement signature (`t("id", { gender: user.gender })`). This bypasses standard AST tracking and is crucial for handling complex grammatical asymmetries (e.g., masculine vs. feminine endings).
- **Behavior**: Variables are recursively parsed. Handles both bracketed expressions (`{var}`) and standard quotes. If this directive is placed immediately before a solitary text variable `{title}`, it forcibly promotes it to an extracted node.

### 3. `@zintl-ignore`

- **Syntax**: `/* @zintl-ignore */` or `<!-- @zintl-ignore -->` (inside HTML strings)
- **Purpose**: Silences the extractor definitively. Any elements or AST components falling under the scope of this directive are completely skipped by the `Intelligent Stitching` engine.
- **Scope Hierarchy**: We implemented an upward traversal pattern `while(current)` inside `parseZintlComments`. This allows parent wrapper components (like `<div class="language-switcher">`) to implicitly mask all nested children from extraction when marked with `{/* @zintl-ignore */}`.
- **HTML Fragment Support**: The parser identifies `<!-- @zintl-ignore -->` tokens within monolithic HTML strings. To prevent whole-string suppression, the ignore state is **scoped** using a closing-tag heuristic: it skips all content until it encounters any closing tag token (e.g., `</button>`). This enables granular exclusion of specific HTML elements within larger `innerHTML` templates.

## Technical Details: The Boundary Wall Architecture

Our parser logic traverses upwards through the AST using `path.parentPath` to find directives. However, it specifically tracks `crossedBoundary` boundaries preventing variable metadata bleeding.

- `@zintl-pass` and `@zintl-note` safely detach when crossing out of their nearest `JSXElement` boundary, preventing an entire page from sharing local translations context.
- `@zintl-ignore`, oppositely, breaks this boundary, tracking upwards to the nearest `Statement`. This provides developers the highly requested functionality to "skip this entire visual block" easily seamlessly via a single parent tag.

## Future Enhancements

- Extend directive scopes deeper towards AST generic template literals outside typical JSX and object properties.
- Potential new directive: `@zintl-group` to explicitly lump multiple AST fragments into a single combined extraction dynamically.
