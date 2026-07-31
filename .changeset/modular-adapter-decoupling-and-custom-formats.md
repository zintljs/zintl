---
"@zintljs/compiler": patch
"zintljs": patch
---

Refactored the compiler and Vite plugin wrapper to establish a fully adapter-driven modular architecture. Eliminated hardcoded fallbacks for extensions in the plugin wrapper config resolved hooks. Preserved physical JSON catalog formats for robust schema-enforcements, auto-healing, and recovery. Added support for custom Handlebars SFC template block extraction and dynamic runtime multi-brand slogans resolution, utilizing robust regex rewriter hooks. Added type definitions for SFC identification on codegen contributions. Unified the HTML projection preset adapter with the compiler's extraction manifest to merge standard extracted text keys and metadata (such as titles, descriptions, and directions) into the generated schemas, resolving validation conflicts under `additionalProperties: false`.
