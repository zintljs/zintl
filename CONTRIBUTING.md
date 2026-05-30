# Zintl Contributing Guide

Thank you for contributing to Zintl! Zintl is a compiler-driven internationalization system built with passion for Vite and performance-oriented web tooling.

This guide outlines our development workflow, commands, and design guidelines to help you get started quickly.

---

## Codebase Principles

When making contributions to Zintl, keep these core architectural principles in mind:

- **Source Purity:** Developers write standard template strings and JSX in the application source. No grammatical logic (like ICU plurals/select forms) belongs in the source code.
- **Zero-Runtime Overhead:** The compiler core parses complex ICU translation catalogs at build time and _bakes_ them into pure JavaScript conditional checks in the generated loader managers. Never ship complex translation parsers to the client.
- **Stable Identity:** Translation boundaries must identify themselves using stable, content-based hashes (`b_<hash>`) to survive codebase renames and refactoring.
- **Clean Terminology:** Avoid internal developer-specific or personal terminology in documentation and comments. Use standard compiler terms:
  - **Boundary:** A file or module containing extractable strings reachable from a Trust Anchor.
  - **Entry Point:** A module calling `zintl()`.
  - **Subtree/Module Dependency:** Code modules that inherit their active locale configuration from their parent boundary.
  - **Code-Split Boundary:** A dynamically imported module representing a partitioned translation chunk.

---

## Monorepo Architecture

Zintl is managed as a pnpm monorepo containing three core packages:

- [**`packages/zintl`**](packages/zintl): The primary developer-facing package. It exports the Vite plugin and the macro runtime APIs (`zintl()`, `t()`, `getLocale()`).
- [**`packages/compiler`**](packages/compiler): The bundler-agnostic compiler intelligence. It contains the pipeline logic for scanning, transformation queue sorting, graph chunking, and ICU baking.
- [**`packages/extractor`**](packages/extractor): The AST-based message extractor. It integrates with high-performance `oxc-parser` to scan module graphs for translatable text nodes and boundary definitions.
- [**`examples/`**](examples): Various template projects (SPA, MPA, SSR, Vue, vanilla) used to test integrations and compile-time mutations.

---

## Local Setup

### Prerequisites

- **Node.js**: Version `>=22.12.0`
- **Package Manager**: `pnpm` (configured in `package.json`)
- **CLI Toolchain**: [Vite+](https://vite.plus/) installed globally as `vp`.

### Workspace Setup

1. Clone the repository.
2. Install dependencies:
   ```bash
   vp install
   ```
3. Initialize the development hooks configuration:
   ```bash
   vp config
   ```

---

## Development Workflows

We use the Vite+ toolchain to orchestrate monorepo workflows.

### 1. Development Servers

To run the compiler and example apps in watch mode concurrently:

```bash
vp run dev
```

### 2. Building Packages

You must build all packages before testing or running the example applications:

```bash
vp run build
```

### 3. Formatting and Linting

Run formatting and lint checks across the monorepo:

```bash
vp check
```

To automatically fix formatting issues:

```bash
vp fmt
```

### 4. Running Tests

We use Vitest to run all test suites:

```bash
vp test
```

To run tests for a specific package or file:

```bash
vp test packages/compiler
vp test sfc_integration.test.ts
```

### 5. Running Benchmarks

Benchmarks verify extraction speeds and HMR latency performance:

```bash
vp run bench
```

### 6. Full Project Verification

Before opening a Pull Request, run the `ready` task to execute all gatekeeper checks (linting, typechecking, full build, test suite execution, and performance budget validation):

```bash
vp run ready
```

---

## Release Flow & Changesets

We use [Changesets](https://github.com/changesets/changesets) to automate versioning and package publishing.

1. When introducing a change that requires a version bump, generate a changeset file:
   ```bash
   vp run change
   ```
2. Follow the interactive CLI prompts to choose the packages to bump (patch, minor, or major) and write a short summary of the change.
3. Commit the generated `.changeset/*.md` file alongside your changes.
