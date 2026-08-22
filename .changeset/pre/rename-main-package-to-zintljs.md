---
"@zintljs/compiler": minor
"@zintljs/extractor": minor
"zintljs": minor
---

Rename the main package from `zintl` to `zintljs`.

npm rejects the bare name `zintl` under its package-name similarity filter (`Package name too similar to existing packages intl,vinyl`). The name is unobtainable, so the primary package is now **`zintljs`**, matching the `@zintljs` npm org and the `zintljs` GitHub org.

**What changed for consumers:**

```diff
- npm install zintl
+ npm install zintljs

- import zintl from "zintl/vite";
- import { zintl } from "zintl/macro";
+ import zintl from "zintljs/vite";
+ import { zintl } from "zintljs/macro";
```

**What did not change:** the `zintl()` macro itself. The package name and the exported identifier are deliberately separate — `ZINTL_MACRO` still resolves the `zintl(...)` call expression, and `bindings` in the boundary graph still read `"zintl"`. Only module specifiers moved.

Internal `virtual:zintl/*` module IDs are unchanged; they are not npm names and keep the project's brand prefix.

`RUNTIME_PACKAGE` and `RUNTIME_SPECIFIERS` in `@zintljs/extractor`, and `MACRO_PACKAGE` in `@zintljs/compiler`, now point at `zintljs`. Because those constants are baked into the compiler's published output, `@zintljs/compiler@0.1.0-alpha.6` cannot recognize the new specifiers and is superseded by this release.
