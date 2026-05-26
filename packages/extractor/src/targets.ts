import type { TargetDescriptor, TargetPlugin } from "./types.js";

export interface ResolvedTargets {
  jsxAttributes: Set<string>;
  jsxElementAttributes: Map<string, Set<string>>;
  domProperties: Set<string>;
  objectFields: Set<string>;
  htmlAttributes: Set<string>;
  plugins: TargetPlugin[];
  fastPathHints: string[];
  uniqueHints: string[];
}

export const TARGET_PRESETS: Record<string, TargetDescriptor[]> = {
  vanilla: [
    "dom:prop:innerHTML",
    "dom:prop:textContent",
    "dom:prop:innerText",
    "dom:prop:value",
    "dom:prop:placeholder",
    "dom:prop:title",
    "dom:prop:ariaLabel",
  ],
  react: [
    "jsx:*:aria-label",
    "jsx:*:alt",
    "jsx:*:title",
    "jsx:*:placeholder",
    "jsx:*:aria-description",
    "jsx:*:label",
    "jsx:*:description",
    "jsx:*:tooltip",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
  ],
  vue: [
    "jsx:*:aria-label",
    "jsx:*:alt",
    "jsx:*:title",
    "jsx:*:placeholder",
    "jsx:*:aria-description",
    "jsx:*:label",
    "jsx:*:description",
    "jsx:*:tooltip",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
    "obj:field:alt",
    "obj:field:placeholder",
    "obj:field:aria-label",
  ],
  svelte: [
    "jsx:*:aria-label",
    "jsx:*:alt",
    "jsx:*:title",
    "jsx:*:placeholder",
    "jsx:*:aria-description",
    "jsx:*:label",
    "jsx:*:description",
    "jsx:*:tooltip",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
    "obj:field:alt",
    "obj:field:placeholder",
    "obj:field:aria-label",
  ],
  html: ["html:attr:alt", "html:attr:aria-label", "html:attr:title", "html:attr:placeholder"],
};

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
  const objectFields = new Set<string>();
  const htmlAttributes = new Set<string>();
  const plugins: TargetPlugin[] = [];
  const fastPathHints: string[] = [];

  const expanded = new Set<TargetDescriptor>();

  function expand(t: TargetDescriptor) {
    if (typeof t === "string") {
      if (TARGET_PRESETS[t]) {
        TARGET_PRESETS[t].forEach(expand);
      } else {
        expanded.add(t);
      }
    } else {
      expanded.add(t);
    }
  }

  targets.forEach(expand);

  for (const item of expanded) {
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

  const resolved = {
    jsxAttributes,
    jsxElementAttributes,
    domProperties,
    objectFields,
    htmlAttributes,
    plugins,
    fastPathHints,
    uniqueHints,
  };

  targetsCache.set(cacheKey, resolved);
  return resolved;
}
