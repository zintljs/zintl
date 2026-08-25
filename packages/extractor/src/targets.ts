/**
 * Target compilation — folding declarative sink descriptors into the lookup
 * structures the visitors execute against.
 *
 * This module is deliberately framework-blind. It understands the structural
 * descriptor DSL (`jsx:`, `tag:`, `dom:`, `obj:field:`, `html:attr:`)
 * and target plugins, and nothing else. It does not know what React, Vue,
 * Svelte or Next.js are, and it holds no preset lists, SFC block rules,
 * mustache patterns or suppression rules of its own.
 *
 * All of that now flows downward from the facet presets in
 * `@zintljs/compiler/facets`, which are the single source of truth. SFC rules,
 * suppression rules and mustache rules reach the extractor as *inputs* on
 * `CompiledExtractionState` — see the compiler's `compileExtractionState`.
 */
import type { TargetDescriptor, TargetPlugin, CompiledExtractionState } from "./types.js";

export type ResolvedTargets = CompiledExtractionState;

let pluginIdCounter = 0;
const pluginIds = new WeakMap<object, string>();

function getTargetKey(t: TargetDescriptor): string {
  if (typeof t === "string") {
    return t;
  }
  if (t && typeof t === "object") {
    let id = pluginIds.get(t);
    if (!id) {
      id = `plugin:${pluginIdCounter++}`;
      pluginIds.set(t, id);
    }
    return id;
  }
  return String(t);
}

/**
 * Memoized per unique descriptor set. Callers must treat the result as
 * read-only — it is shared. The compiler's `compileExtractionState` copies it
 * before attaching rules, which is what keeps two compilers with identical
 * descriptors from clobbering each other.
 */
const targetsCache = new Map<string, ResolvedTargets>();

export function resolveTargets(targets: TargetDescriptor[]): ResolvedTargets {
  const cacheKey = targets.map(getTargetKey).join("|");
  const cached = targetsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const jsxAttributes = new Set<string>();
  const jsxElementAttributes = new Map<string, Set<string>>();
  const domProperties = new Set<string>();
  const domReceiverProperties = new Map<string, Set<string>>();
  const taggedTemplates = new Set<string>();
  const objectFields = new Set<string>();
  const objectNameFields = new Map<string, Set<string>>();
  const callFields = new Map<string, Set<string>>();
  const htmlAttributes = new Set<string>();
  const plugins: TargetPlugin[] = [];
  const fastPathHints: string[] = [];

  /**
   * Refuse a descriptor rather than ignore it.
   *
   * Every unmatched string used to fall out of this loop and contribute
   * nothing — no target, no hint, no message. A typo (`dom:prop:titel`) and a
   * form that does not exist (`obj:ui:title`) both resolved to silence, so the
   * user asked for an extraction, got none, and had nothing to read. That is
   * the same silent under-extraction that makes a missing sink invisible, only
   * arriving through a config file, where it is worse: the intent was stated.
   *
   * Loud at construction, like an unknown facet or an unsupported host.
   */
  const reject = (item: string, why: string): never => {
    throw new Error(
      `[Zintl] Invalid extraction target: ${JSON.stringify(item)} — ${why}.\n\n` +
        `Valid forms:\n` +
        `  jsx:<element>:<attribute>   e.g. jsx:*:alt, jsx:html:dir\n` +
        `  html:attr:<attribute>       e.g. html:attr:placeholder\n` +
        `  dom:<receiver>:<property>   e.g. dom:*:innerHTML, dom:document:title\n` +
        `  dom:prop:<property>         the original spelling of dom:*:<property>\n` +
        `  obj:<binding>:<field>       e.g. obj:*:label, obj:ui:title\n` +
        `  obj:field:<field>           the original spelling of obj:*:<field>\n` +
        `  call:<function>:<field>     e.g. call:defineConfig:title\n` +
        `  tag:<function>              e.g. tag:html\n\n` +
        `A target plugin object is also accepted. See docs/configuration.md.`,
    );
  };

  /** `a:b:c` with no empty segment, or a reason it is not. */
  const triple = (item: string): string[] => {
    const parts = item.split(":");
    if (parts.length !== 3) {
      reject(item, `expected three colon-separated parts, got ${parts.length}`);
    }
    if (parts.some((p) => p.length === 0)) reject(item, "one of its parts is empty");
    return parts;
  };

  /** The tail after a fixed prefix, or a reason it is unusable. */
  const tail = (item: string, prefix: string): string => {
    const value = item.substring(prefix.length);
    if (value.length === 0) reject(item, `nothing follows "${prefix}"`);
    if (value.includes(":")) reject(item, `"${prefix}" takes a single name, not a path`);
    return value;
  };

  for (const item of new Set(targets)) {
    if (typeof item === "string") {
      if (item.startsWith("jsx:")) {
        // format: jsx:<element>:<attribute>
        const [, element, attr] = triple(item);
        if (element === "*") {
          jsxAttributes.add(attr);
        } else {
          let attrs = jsxElementAttributes.get(element);
          if (!attrs) {
            attrs = new Set();
            jsxElementAttributes.set(element, attrs);
          }
          attrs.add(attr);
        }
        fastPathHints.push(attr);
      } else if (item.startsWith("tag:")) {
        const tag = tail(item, "tag:");
        taggedTemplates.add(tag);
        fastPathHints.push(tag);
      } else if (item.startsWith("dom:") && !item.startsWith("dom:attr:")) {
        /**
         * `dom:<receiver>:<property>`, mirroring `jsx:<element>:<attribute>`.
         *
         * `prop` and `*` are the any-receiver spellings and behave identically —
         * `prop` because it is what the DSL has always used, `*` because it is
         * what the `jsx:` family uses and there is no reason for two
         * conventions. Anything else is an identifier the receiver must match,
         * which is what turns `document.title` into evidence rather than a
         * guess about a noun.
         */
        const [, receiver, prop] = triple(item);
        if (receiver === "prop" || receiver === "*") {
          domProperties.add(prop);
        } else {
          let props = domReceiverProperties.get(receiver);
          if (!props) {
            props = new Set();
            domReceiverProperties.set(receiver, props);
          }
          props.add(prop);
        }
        fastPathHints.push(prop);
      } else if (item.startsWith("dom:attr:")) {
        /**
         * Declared in the descriptor union and documented in this file's own
         * header, and never implemented — it registered a fast-path hint and was
         * added to no target set, so it matched nothing. Saying so is the point
         * of this pass; a form that has never worked should not keep looking
         * like it does.
         */
        reject(item, "`dom:attr:` is not implemented — use `dom:<receiver>:<property>`");
      } else if (item.startsWith("obj:")) {
        /**
         * `obj:<binding>:<field>`, with `field` and `*` meaning any object.
         *
         * `obj:*:title` is honest about what the unqualified form does — match
         * a field name on *any* object literal anywhere, which is a guess about
         * a noun rather than evidence. `obj:ui:title` narrows it to a binding
         * the project named, which is the same trade `dom:document:title`
         * makes: still a name, but one the author chose and controls.
         */
        const [, binding, field] = triple(item);
        if (binding === "field" || binding === "*") {
          objectFields.add(field);
        } else {
          let fields = objectNameFields.get(binding);
          if (!fields) {
            fields = new Set();
            objectNameFields.set(binding, fields);
          }
          fields.add(field);
        }
        fastPathHints.push(field);
      } else if (item.startsWith("call:")) {
        /**
         * `call:<function>:<field>` — a field of an object literal passed to a
         * call of that function, e.g. `defineConfig({ title })`.
         *
         * Deliberately its own family rather than a spelling of `obj:`. "The
         * object passed to `cfg()`" and "the object bound to `cfg`" are
         * different relations, and folding them together would make
         * `call:cfg:title` silently match a `const cfg = { title }` that has
         * nothing to do with the call.
         */
        const [, fn, field] = triple(item);
        let fields = callFields.get(fn);
        if (!fields) {
          fields = new Set();
          callFields.set(fn, fields);
        }
        fields.add(field);
        fastPathHints.push(field);
      } else if (item.startsWith("html:attr:")) {
        const attr = tail(item, "html:attr:");
        htmlAttributes.add(attr);
        fastPathHints.push(attr);
      } else {
        reject(item, "unrecognised form");
      }
    } else if (item && typeof item === "object") {
      plugins.push(item);
      if (item.fastPathHint) {
        if (Array.isArray(item.fastPathHint)) {
          fastPathHints.push(...item.fastPathHint);
        } else {
          fastPathHints.push(item.fastPathHint);
        }
      }
    }
  }

  const uniqueHints = Array.from(new Set(fastPathHints));

  // Derive fast-path capabilities from what has been configured.
  // This regex is built once per unique target combination and cached.
  const hasDomSinks = domProperties.size > 0 || domReceiverProperties.size > 0;
  const hasTaggedTemplateSinks = taggedTemplates.size > 0;
  const hasJsxSinks = jsxAttributes.size > 0 || jsxElementAttributes.size > 0;
  const hasHtmlSinks = htmlAttributes.size > 0;

  const patternParts: string[] = [
    // Zintl-core tokens always included — they are framework-agnostic
    "zintl",
    "loadI18nInstance",
    "t\\(",
    // All resolved sink hints (aria-label, innerHTML, title, …)
    ...uniqueHints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  ];
  // Only include '<' when JSX or HTML templates are a configured target
  if (hasJsxSinks || hasHtmlSinks || hasTaggedTemplateSinks) patternParts.push("<");

  const fastPathRegex = new RegExp(patternParts.join("|"));

  const resolved: ResolvedTargets = {
    jsxAttributes,
    jsxElementAttributes,
    domProperties,
    domReceiverProperties,
    taggedTemplates,
    objectFields,
    objectNameFields,
    callFields,
    htmlAttributes,
    plugins,
    fastPathHints,
    uniqueHints,
    fastPathRegex,
    hasDomSinks,
    hasTaggedTemplateSinks,
    hasJsxSinks,
    // Framework rules are supplied by the caller, never invented here.
    sfcRules: [],
    suppressionRules: [],
    mustacheRegex: null,
  };

  targetsCache.set(cacheKey, resolved);
  return resolved;
}
