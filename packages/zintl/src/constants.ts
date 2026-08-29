import { join, relative, sep } from "node:path";

export const VIRTUAL_PREFIX = "virtual:zintl-catalog";
export const CHUNK_VIRTUAL_PREFIX = "virtual:zintl/catalog";
export const CONTENT_VIRTUAL_PREFIX = "virtual:zintl/content";
export const MANAGER_VIRTUAL_PREFIX = "virtual:zintl/manager";
export const RESOLVED_VIRTUAL_PREFIX = "\0" + VIRTUAL_PREFIX;
export const RESOLVED_CHUNK_PREFIX = "\0" + CHUNK_VIRTUAL_PREFIX;
export const RESOLVED_CONTENT_PREFIX = "\0" + CONTENT_VIRTUAL_PREFIX;
export const RESOLVED_MANAGER_PREFIX = "\0" + MANAGER_VIRTUAL_PREFIX;
export const PLUGIN_NAME = "zintl";
/**
 * Raw text assets Zintl turns into JavaScript.
 *
 * A `.md`/`.txt` import with `?raw` or `?zintl-raw` is loaded as a JS module, so
 * it must not keep an identity that still says "text file". Rspack types modules
 * by the resource's extension, so `about.txt?raw` is classified as an asset and
 * the JavaScript we return is base64-encoded into a `data:` URI — a build that
 * succeeds and ships a URI where the translation belongs (ledger L-009).
 *
 * An extension-free virtual id has nothing for a host to mistype.
 */
const RAW_ASSET_VIRTUAL_PREFIX = "virtual:zintl/rawasset";
/**
 * Only the resolved form is exported: unlike the catalog and manager prefixes,
 * nothing ever writes this id in source for the plugin to recognise. It is
 * minted during resolution and consumed during load, so the bare prefix has no
 * callers outside this file.
 */
export const RESOLVED_RAW_ASSET_PREFIX = "\0" + RAW_ASSET_VIRTUAL_PREFIX;

/**
 * The same trick for the other delivery mode.
 *
 * A plain import of a targeted asset resolves to a *module* that follows the
 * active locale, so it needs an identity for exactly the reasons the raw prefix
 * documents above — and for one more. The generated module imports
 * `virtual:zintl/runtime/internal`, and unplugin materialises a virtual module
 * as a real file inside `node_modules/.virtual/`; leaving the id as the asset's
 * own path put that file next to the asset instead, where the bare specifier no
 * longer resolved and Rspack reported a missing module three directories away
 * from the cause.
 */
const URL_ASSET_VIRTUAL_PREFIX = "virtual:zintl/urlasset";
export const RESOLVED_URL_ASSET_PREFIX = "\0" + URL_ASSET_VIRTUAL_PREFIX;
export const RUNTIME_VIRTUAL_ID = "virtual:zintl/runtime";
export const RUNTIME_INTERNAL_VIRTUAL_ID = "virtual:zintl/runtime/internal";

/**
 * Encode a Zintl-owned asset module's identity, **relative to the project root**.
 *
 * The encoding itself is explained where the prefixes are declared above: an
 * extension-free id is what stops a host typing the module by its `.md` and
 * base64-ing our JavaScript into a `data:` URI (L-009).
 *
 * What is relative and why: the id becomes the emitted chunk's *name*, so
 * encoding the absolute path published the build machine's filesystem. A page
 * body shipped as
 *
 * ```
 * assets/L1VzZXJzL2toYWxpZC9MaW5ndWEvbGluZ3VhL2V4YW1wbGVzL3dlYnNpdGUv….js
 * ```
 *
 * which decodes to `/Users/<someone>/…/src/content/what-is-zintl.md?raw`. A
 * public artifact should not carry the machine it was built on, and anyone with
 * a base64 decoder had the author's home directory. Encoding
 * `src/content/what-is-zintl.md?raw` instead keeps every property the design
 * relies on — opaque, extension-free, unique within the project, and a pure
 * function of the input — while naming a shorter chunk that says nothing about
 * where it was built.
 *
 * A file outside the root encodes as `../…`, which round-trips and still names
 * no absolute location.
 */
export function encodeAssetId(prefix: string, root: string, fullId: string): string {
  const q = fullId.indexOf("?");
  const path = q === -1 ? fullId : fullId.slice(0, q);
  const query = q === -1 ? "" : fullId.slice(q);
  const rel = toPosix(relative(root, path));
  return `${prefix}/${Buffer.from(rel + query, "utf8").toString("base64url")}`;
}

/** The inverse of {@link encodeAssetId}, back to the absolute id and its query. */
export function decodeAssetId(prefix: string, root: string, id: string): string {
  const decoded = Buffer.from(id.slice(prefix.length + 1), "base64url").toString("utf8");
  const q = decoded.indexOf("?");
  const path = q === -1 ? decoded : decoded.slice(0, q);
  const query = q === -1 ? "" : decoded.slice(q);
  return toPosix(join(root, path)) + query;
}

/**
 * Module ids are forward-slashed on every platform, including Windows, so a
 * path that has been through `node:path` has to be put back before it is
 * compared against one.
 */
function toPosix(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}
