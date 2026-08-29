---
"@zintljs/compiler": patch
"zintljs": patch
---

Read the locale from below the base path, not from the top of the URL.

`syncLocale` took the locale from the first segment of `location.pathname`, and the HTML bootstrap
did the same. For an app served from a domain root that is correct. For one served under a base
path it reads the base:

```
/zintl/ar/guide/what-is-zintl
 ^^^^^ ← "the locale"
```

`zintl` names no locale, so the lookup fell through to `<html lang>` and to storage, and a site
deployed under a sub-path served every reader its **source language** no matter which URL they
opened. Silently — the page rendered, in the wrong language, with the right one in the address bar.

This is not an unusual deployment. GitHub Pages project sites, anything behind a path-prefixed
reverse proxy, and any app mounted under a sub-path all hit it, and path-based locale routing is the
shape the client facet was built for.

The base now reaches the runtime as `__ZINTL_BASE__`, folded to a literal by `getRuntimeCode` the
same way `__ZINTL_RTL_LOCALES__` is, and to the HTML projection as an argument to `transformHtml`.
Both strip it before looking for a locale. It comes from the resolved config — the same
`ctx.publicBase` the preload URLs already use — so nothing new has to be configured.

`"/"` is the default at every level, so an app at a domain root is unaffected: across the suite this
changes two generated lines and no behaviour, and every project still resolves its locale exactly as
before.

Found by deploying the documentation site to `zintljs.github.io/zintl/`, where every page rendered
in English.
