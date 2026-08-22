---
"@zintljs/testing": minor
---

Decouple contract tests from `examples/` and add inline fixtures.

Contracts could only ever run against real applications on disk, which blocked whole categories of coverage: nothing in `examples/` exercises `assetsTarget`, and asking "does this break only under one framework, or one bundler?" would have meant authoring a full demo app per combination.

The contract architecture already had the right shape — `Contract` declares `requires: Capability[]` and never names an example — so the coupling was a single hardcoded line, duplicated in `createLab` and `createProjectLab`:

```ts
const root = join(MONOREPO_ROOT, "examples", opts.example);
```

**`ProjectSource`** replaces it. A manifest now declares _where its project comes from_:

- `exampleSource(dir)` — a directory under `examples/`, unchanged behaviour.
- `fixtureSource({ id, files, zintlOptions })` — a project defined inline as a path → contents map, materialized under `.tmp/fixtures/` and given a generated `vite.config.ts` unless `files` supplies one.

Fixtures materialize _inside_ the repo rather than the OS temp directory, so Node resolves `zintljs`, `vite`, and framework plugins by walking up to the root `node_modules`. `ZINTL_KEEP_FIXTURES=1` leaves them on disk for inspection.

Materialization wipes first: a fixture is defined entirely by its `files` map, so leftovers would be invisible extra inputs. Teardown cleanup is best-effort by design — dev servers are pooled and outlive an individual lab, so one can flush catalogs and re-create part of the directory afterwards.

**Breaking:** `ExampleManifest` is now `ProjectManifest` and requires a `source`. `LabOptions` / `ProjectLabOptions` take `source: ProjectSource` instead of `example: string`. Adds the `assets` capability.
