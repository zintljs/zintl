# Stability

Zintl is in **alpha**, heading for beta. This page exists so "alpha" reads as a schedule rather than a warning: which surfaces you can build on now, which are still moving, and how you find out when one changes.

Nobody minds a breaking change. They mind an unannounced one.

## What is settled

These have their shape. A change here would be a deliberate, announced break with a migration note — not a patch release.

| Surface                              | The commitment                                                                                                                                     |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`zintl(locale)`**                  | The anchor call, its literal-vs-variable meaning, and `await`-ability. The whole API surface an app touches.                                       |
| **`zintljs/macro`**                  | `zintl`, `t`, `getLocale`, `setLocale`, `subscribe`, and their untransformed fallbacks.                                                            |
| **Entry points**                     | `zintljs/vite` and `zintljs/rsbuild`, both taking the same options object.                                                                         |
| **`locales`, `sourceLocale`**        | Names, types, and the rule that the source locale is never written to disk.                                                                        |
| **Catalogs on disk**                 | Plain JSON, one key per source string, the value being the translation. Yours to commit, edit, and hand to a translator or a TMS.                  |
| **`outputDir`, `catalogFormat`**     | Where catalogs go and the token vocabulary that names them.                                                                                        |
| **Content-based identity**           | Move a file, rename a component, restructure a directory — translations follow. Tying identity to a path or a line number would be the regression. |
| **No fallback to the source locale** | A missing translation fails the build. This is a principle, not a default, and it is not getting an override.                                      |

## What is still moving

Real, working, and not yet frozen. Pin your version if you depend on these.

| Surface                        | What might change                                                                                                                                                                                                                                  |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `facets` API**           | Facet object shape, hook names, and the fields `when` accepts. The extension point is real and tested, but it is the youngest surface here.                                                                                                        |
| **Option / facet overlap**     | `assetsTarget` and `virtualAssets` exist both as top-level options and on the facet that consumes them. Convenient, and one concept spelled two ways. **This is the surface we most expect to revisit before 1.0.** See the precedence rule below. |
| **ICU details**                | The grammar you write in catalogs works; the exact set of supported constructs is still growing.                                                                                                                                                   |
| **Boundary id encoding**       | That identity is content-based is settled. The `b_<hash>` spelling behind `[bId]` and `[hash]` is not a contract — do not parse it.                                                                                                                |
| **Next.js via vinext**         | Experimental. Builds and runs; no contract test drives it. See [Configuration](configuration.md#nextjs-via-vinext).                                                                                                                                |
| **Diagnostics and log output** | Error text, the activation trace, and debug channels are meant to be read by people, not parsed by scripts.                                                                                                                                        |

### The one precedence rule worth knowing today

Because top-level options and facet options overlap, it matters which wins. A facet you name replaces the built-in of the same name, and the activation trace says so:

```
✗ system-static-assets (built-in)   replaced by the "system-static-assets" facet you passed
```

Order does not decide it — `["builtins", myAssets]` and `[myAssets, "builtins"]` behave identically. Top-level `assetsTarget` and `virtualAssets` configure the _built-in_ assets facet; if you replace it, configure yours directly instead.

## How a change reaches you

Releases go out from changesets, and every one carries a changelog entry saying what changed and why — those entries are written to be read, not generated. Alpha builds publish under the `alpha` dist-tag.

```bash
npm install -D zintljs@alpha
```

Pin an exact version while we are pre-1.0. If a release surprises you, [that is worth an issue](https://github.com/zintljs/zintl/issues) even if it was announced — an announced break that still hurt is a sign the migration note was not good enough.

## Removing Zintl

Worth knowing before you adopt, not after.

**Your source never changed.** There are no `t()` calls to unwind, no keys to delete, no dictionary to reconcile. The strings in your components are the strings you wrote. So removing Zintl is:

1. Delete the plugin from your Vite or Rsbuild config.
2. `npm uninstall zintljs`
3. Delete `zintl/` — the catalogs — if you do not want the translations kept.

What is left is the monolingual app you started with, compiling and running. The only code you wrote _for_ Zintl is the `zintl(locale)` call and whatever UI you built for changing language.

You can also stop halfway. `zintljs/macro` is a set of compiler markers whose untransformed bodies are real: `t(key)` returns the key, `setLocale()` resolves, `zintl()` is inert. An app that still imports them but no longer runs the plugin — a plain `tsc` run, a unit test, a build where you removed the plugin and not the import — renders in its source locale rather than crashing.

This is a consequence of the design rather than a feature bolted onto it: a compiler that reads plain strings has nothing to leave behind. It is also the honest answer to _"why would I make a build-critical dependency out of an alpha compiler from a small team"_ — adopting Zintl is reversible, and reversing it costs one commit.

**What you would lose** is the link between translations and source. The catalogs are plain JSON keyed by the source string, so the content itself survives in a form any other tool can read. Nothing keeps them in sync once the compiler stops running.
