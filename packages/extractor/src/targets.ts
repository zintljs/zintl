import type { TargetDescriptor, TargetPlugin, SfcRule, SuppressionRule } from "./types.js";

export interface ResolvedTargets {
  jsxAttributes: Set<string>;
  jsxElementAttributes: Map<string, Set<string>>;
  domProperties: Set<string>;
  objectFields: Set<string>;
  htmlAttributes: Set<string>;
  plugins: TargetPlugin[];
  fastPathHints: string[];
  uniqueHints: string[];
  /** Pre-built regex for file-level fast-path gating. Derived from uniqueHints + core tokens. */
  fastPathRegex: RegExp;
  /** True when at least one dom:prop target is configured (e.g. innerHTML). */
  hasDomSinks: boolean;
  /** True when at least one jsx: target is configured. */
  hasJsxSinks: boolean;
  sfcRules: SfcRule[];
  suppressionRules: SuppressionRule[];
  mustacheRegex?: RegExp | null;
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
    "jsx:html:dir",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
  ],
  nextjs: [
    "jsx:*:aria-label",
    "jsx:*:alt",
    "jsx:*:title",
    "jsx:*:placeholder",
    "jsx:*:aria-description",
    "jsx:*:label",
    "jsx:*:description",
    "jsx:*:tooltip",
    "jsx:html:dir",
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
    "jsx:html:dir",
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
    "jsx:html:dir",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
    "obj:field:alt",
    "obj:field:placeholder",
    "obj:field:aria-label",
  ],
  html: [
    "html:attr:alt",
    "html:attr:aria-label",
    "html:attr:title",
    "html:attr:placeholder",
    "html:attr:dir",
  ],
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

export interface TargetMetadata {
  sfcRules?: SfcRule[];
  suppressionRules?: SuppressionRule[];
  mustacheRegex?: RegExp;
}

export const TARGET_METADATA: Record<string, TargetMetadata> = {
  vue: {
    sfcRules: [
      {
        extensions: [".vue"],
        blocks: [
          {
            id: "script",
            pattern: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
            action: "javascript",
            resolveVirtualExtension: (attrs) => {
              const langMatch = /lang=["']([^"']+)["']/i.exec(attrs);
              const lang = langMatch ? langMatch[1] : "js";
              return lang === "ts" || lang === "tsx" ? ".tsx" : ".jsx";
            },
          },
          {
            id: "template",
            pattern: /<template\b([^>]*)>([\s\S]*?)<\/template>/gi,
            action: "html",
            isActiveContent: true,
          },
          {
            id: "style",
            pattern: /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
            action: "ignore",
          },
        ],
      },
    ],
    mustacheRegex: /\{\{([\s\S]*?)\}\}/g,
  },
  svelte: {
    sfcRules: [
      {
        extensions: [".svelte"],
        blocks: [
          {
            id: "script",
            pattern: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
            action: "javascript",
            resolveVirtualExtension: (attrs) => {
              const langMatch = /lang=["']([^"']+)["']/i.exec(attrs);
              const lang = langMatch ? langMatch[1] : "js";
              return lang === "ts" || lang === "tsx" ? ".tsx" : ".jsx";
            },
          },
          {
            id: "style",
            pattern: /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
            action: "ignore",
          },
        ],
      },
    ],
    mustacheRegex: /\{([^{}]+)\}/g,
  },
  nextjs: {
    suppressionRules: [
      {
        targets: ["nextjs"],
        match: {
          types: ["FunctionDeclaration", "VariableDeclarator"],
          names: ["generateMetadata", "generateViewport", "metadata", "viewport"],
          isTopLevel: true,
        },
        bypassIf: "hasAnchor",
      },
    ],
  },
};

export const DEFAULT_SFC_RULES: SfcRule[] = [
  ...TARGET_METADATA.vue.sfcRules!,
  ...TARGET_METADATA.svelte.sfcRules!,
];

export const DEFAULT_SUPPRESSION_RULES: SuppressionRule[] = [
  ...TARGET_METADATA.nextjs.suppressionRules!,
];

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

  // Derive fast-path capabilities from what has been configured.
  // This regex is built once per unique target combination and cached.
  const hasDomSinks = domProperties.size > 0;
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
  if (hasJsxSinks || hasHtmlSinks) patternParts.push("<");

  const fastPathRegex = new RegExp(patternParts.join("|"));

  const sfcRules: SfcRule[] = [];
  const suppressionRules: SuppressionRule[] = [];
  let mustacheRegex: RegExp | null = null;

  for (const t of targets) {
    if (typeof t === "string" && TARGET_METADATA[t]) {
      const meta = TARGET_METADATA[t];
      if (meta.sfcRules) sfcRules.push(...meta.sfcRules);
      if (meta.suppressionRules) suppressionRules.push(...meta.suppressionRules);
      if (meta.mustacheRegex) mustacheRegex = meta.mustacheRegex;
    }
  }

  const resolved: ResolvedTargets = {
    jsxAttributes,
    jsxElementAttributes,
    domProperties,
    objectFields,
    htmlAttributes,
    plugins,
    fastPathHints,
    uniqueHints,
    fastPathRegex,
    hasDomSinks,
    hasJsxSinks,
    sfcRules,
    suppressionRules,
    mustacheRegex,
  };

  targetsCache.set(cacheKey, resolved);
  return resolved;
}
