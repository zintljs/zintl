# Zintl ICU Reference Specification (ZCU)

**Version**: 1.0  
**Status**: Draft  
**Mantra**: _Measure the shame, sharpen the ZCU, Bakalau!_

---

## §1 — The ZCU Philosophy

ZCU (Zintl Component-based ICU) brings the immense power of the ICU MessageFormat to Zintl without violating the **Source Purity** axiom of the Zintl Architecture.

Traditional ICU forces developers to pollute their source code with complex grammatical rules (`{count, plural, =0 {...} ...}`). This makes the code hard to read and breaks syntax highlighting and standard template string usage.

**The ZCU Agreement:**

1. **Source Purity**: Source files (`.ts`, `.tsx`, HTML) use standard, pure JS template literals or JSX expressions. No ICU syntax is permitted in the source.
2. **Grammar as Data**: The ICU syntax lives exclusively in the translation catalogs (`.json` files) where it belongs: managed by translators, not hardcoded by developers.
3. **Zero-Runtime Guarantee (Macro Baking)**: Zintl's compiler parses the complex ICU structures at build time and _bakes_ them into highly optimized, zero-dependency, pure JS `if/switch` statements. No heavy parser is ever shipped to the browser.
4. **Context Injection**: Developers explicitly pass grammatical context (e.g., gender, plural indicators) using Zintl Directives (`@zintl-pass`) when the original UI text does not inherently expose them.

---

## §2 — The Development Workflow (How it looks)

### 2.1 — Writing the Source Code

You write beautiful, idiomatic JS template literals or JSX.

```jsx
// ❌ Traditional ICU (Ugly, breaks highlighting, mixes logic)
<div>{t("cart_msg", { count })}</div>

// ✅ ZCU Way (Pure, readable, native)
<div>You have {count} items in your cart</div>
// Wait, actually, in Zintl source code, it's native JS template literals:
element.innerHTML = `You have ${count} items in your cart`;
```

**The Universal Identifier Gap**:
When Zintl extracts `` `You have ${count} items` ``, it normalizes the JS expression into a stable catalog key: `"You have {count} items"`.
If a developer organically types a literal brace: `` `Zintl parts: {extractor, runtime}` ``, the extractor distinguishes between an actual AST expression `${var}` and static strings. At runtime, the resolver safely ignores literal braces unless they strongly map to a supplied parameter.

### 2.2 — The Extraction Pipeline

The `@zintl/extractor` captures JS literals organically. The default schema generated will be a standard string, using the normalized `{var}` format for variables.

### 2.3 — Adding Grammatical Context (The `@zintl-pass` Escape Hatch)

What if a target language needs to translate differently based on the user's gender, but "gender" isn't printed on the screen?

```jsx
function Welcome({ user, role }) {
  return (
    <h1>
      {/* @zintl-pass role */}
      Welcome to the dashboard, {user}!
    </h1>
  );
}
```

Zintl extracts the stitched key `"Welcome to the dashboard, {user}!"`. **But how does the translator know `role` exists?**
JSON doesn't support comments, so Zintl injects a strict `$schema` property at the top of the generated `.json` file. The translator's IDE (or any translation platform) reads the schema to provide precise autocomplete, informing them that `{role}` is an available parameter!

---

## §3 — The Catalog Specification (ICU Standard)

Zintl JSON files are upgraded from basic key-value to full ICU-MessageFormat compliance, verified by strict `$schema` definitions.

### 3.1 — Pluralization

Translators write standard ICU plural syntax in their local JSON:

```json
{
  "You have {count} items in your cart": "{count, plural, =0 {Your cart is empty} one {You have one single item} other {You have {count} items in your cart}}"
}
```

### 3.2 — Select (Gender / Enum)

Used for roles, genders, or any categorical variations.

```json
{
  "Welcome to the dashboard, {user}!": "{role, select, admin {Access granted, Almighty {user}!} guest {Welcome, visitor {user}.} other {Welcome to the dashboard, {user}!}}"
}
```

### 3.3 — Complex Nesting

ZCU strongly supports combined logic natively within the catalog.

```json
{
  "{host} invites you to {count} events": "{hostGender, select, female {{host} invites you to her {count, plural, one {only event} other {# events}}} male {{host} invites you to his {count, plural, one {only event} other {# events}}} other {{host} invites you to their {count, plural, one {only event} other {# events}}}}"
}
```

---

## §4 — The Source Environment Asymmetry (The Ghost Constraint)

Because Zintl is designed around **Zero-Disk Ghost Mode** for the `sourceLocale` (usually English), there is no `en.json` written to disk. The source locale operates entirely off the extracted keys.

This creates a fundamental law in ZCU:

> **ICU MessageFormat cannot be used for the Source Locale.**

Since the logic of the source locale must exist entirely in the source code, any grammatical branching for the source language (like pluralization) must be written as pure JavaScript logic.

### 4.1 — Resolution via Javascript Branching

If English needs a plural rule, it must be branched in the JS:

```jsx
// ✅ Correct (ZCU Source Logic)
element.innerHTML = count === 1 ? `You have 1 item` : `You have ${count} items`;
```

This creates **two independent boundaries/keys** in the catalog:

1. `"You have 1 item"`
2. `"You have {count} items"`

### 4.2 — The Expansion Gap (Target ICU)

If the target language (e.g., Arabic) needs 6 plural forms, the translator simply hooks into the dynamic key (`"You have {count} items"`) in the Arabic `.json` and applies ICU:

```json
{
  "You have 1 item": "لديك عنصر واحد",
  "You have {count} items": "{count, plural, =2 {لديك عنصران} few {لديك {count} عناصر} other {لديك {count} عنصرًا}}"
}
```

The English source code stays readable. Arabic gets full grammatical power.

---

## §5 — Architecture of the "Baking" Engine

This is where Zintl differentiates itself. The compiler takes the ICU strings from the catalogs and executes **Macro Baking**.

When Zintl runs `compile()`, it reads:
`"{count, plural, =0 {No items} one {One item} other {# items}}"`

It does **not** ship this string to the runtime. Instead, it generates a virtual chunk (Smart Manager):

```javascript
// Generated Virtual Module Chunk (b_hash123)
export default {
  "You have {count} items": (params) => {
    const { count } = params;
    if (count === 0) return `No items`;
    if (count === 1) return `One item`;
    return `${count} items`; // Note: '#' is safely converted to the variable
  },
};
```

**Benefits:**

- **Insanely Fast**: JS engine `if` statements are magnitudes faster than AST parsing ICU formats on the client.
- **Tiny Bundle**: You don't need `intl-messageformat` or `@formatjs/icu-messageformat-parser` in your final vendor chunk (saving ~30-50kb).

---

## §6 — Resolver & Ghost Mode

### 6.1 — The Runtime Resolver

The `t()` function expects either a string or a generated function.

```typescript
if (typeof message === "function") {
  return message(params); // Executes the baked ZCU logic instantly
}
```

### 6.2 — Phase Plan for Implementation

**Phase 1: Lexical Upgrade**

- Add the ICU AST parser purely for build-time validation and processing.

**Phase 2: The Baker**

- Implement the AST translator that traverses ICU `plural` and `select` trees and outputs nested Javascript `if/switch` blocks via `serializeCatalog`.

**Phase 3: Schema Enrichment**

- Ensure `$schema` rigorously exports all explicitly extracted variables and `@zintl-pass` directives so IDEs prompt the translator effectively.

---

_The bloat is dead, the parsers are baked, Claritas!_
