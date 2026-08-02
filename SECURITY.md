# Security Policy

## Supported versions

Zintl is in alpha. Only the latest published version receives fixes — please upgrade before reporting.

| Version                  | Supported |
| :----------------------- | :-------- |
| `0.1.0-alpha.*` (latest) | ✅        |
| anything older           | ❌        |

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private reporting instead:

**[Report a vulnerability →](https://github.com/zintljs/zintl/security/advisories/new)**

If that isn't available to you, email **dev.khalid@me.com** with `[security]` in the subject.

Please include what you'd want to receive yourself: what the issue is, how to reproduce it, which version you saw it on, and what you think an attacker could do with it.

## What to expect

This is a solo project, so response times are honest rather than corporate: I'll acknowledge within a few days, and tell you plainly whether I think it's a real issue and roughly when it'll be fixed. If I disagree that it's a vulnerability I'll explain why rather than going quiet.

Credit in the release notes if you'd like it — just say so.

## Scope worth knowing about

Zintl is build-time tooling. It reads your source files, writes catalog files inside your project, and injects generated code into your bundle. The parts most worth scrutiny:

- **Generated runtime code** — the compiler emits JavaScript into your bundle. Anything that lets untrusted content reach that output is serious.
- **Catalog files** — translations are read from JSON on disk and compiled into your app. A catalog is executable input, not inert data.
- **File writes** — the compiler writes catalogs and metadata into your project. Paths escaping the project root would be a bug worth reporting.

Development-only diagnostics (the `__ZINTL_DEV__` branches, the settle beacon) are eliminated from production builds. If you find any of it in a production bundle, that's a defect and worth a report even if you can't attach an exploit to it.
