/**
 * Target compilation — folding declarative sink descriptors into the lookup
 * structures the visitors execute against.
 *
 * This module is deliberately framework-blind. It understands the structural
 * descriptor DSL (`jsx:`, `tag:`, `dom:prop:`, `dom:attr:`, `obj:field:`, `html:attr:`)
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
  const taggedTemplates = new Set<string>();
  const objectFields = new Set<string>();
  const htmlAttributes = new Set<string>();
  const plugins: TargetPlugin[] = [];
  const fastPathHints: string[] = [];

  for (const item of new Set(targets)) {
    if (typeof item === "string") {
      if (item.startsWith("jsx:")) {
        // format: jsx:<element>:<attribute>
        const parts = item.split(":");
        if (parts.length === 3) {
          const [, element, attr] = parts;
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
        }
      } else if (item.startsWith("tag:")) {
        const tag = item.substring("tag:".length);
        taggedTemplates.add(tag);
        fastPathHints.push(tag);
      } else if (item.startsWith("dom:prop:")) {
        const prop = item.substring("dom:prop:".length);
        domProperties.add(prop);
        fastPathHints.push(prop);
      } else if (item.startsWith("dom:attr:")) {
        // We can treat DOM attributes similarly or just support them in visitors
        const attr = item.substring("dom:attr:".length);
        fastPathHints.push(attr);
      } else if (item.startsWith("obj:field:")) {
        const field = item.substring("obj:field:".length);
        objectFields.add(field);
        fastPathHints.push(field);
      } else if (item.startsWith("html:attr:")) {
        const attr = item.substring("html:attr:".length);
        htmlAttributes.add(attr);
        fastPathHints.push(attr);
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
  const hasDomSinks = domProperties.size > 0;
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
    taggedTemplates,
    objectFields,
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
