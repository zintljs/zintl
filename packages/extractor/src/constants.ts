export const DEFAULT_UI_ATTRIBUTES = new Set([
  "aria-label",
  "alt",
  "title",
  "placeholder",
  "aria-description",
  "label",
  "description",
  "tooltip",
]);

export const DEFAULT_UI_OBJECT_FIELDS = new Set([
  "label",
  "title",
  "description",
  "text",
  "tooltip",
]);

export const DEFAULT_UI_SINK_PROPERTIES = [
  "innerHTML",
  "textContent",
  "innerText",
  "value",
  "placeholder",
  "title",
  "ariaLabel",
];

export const ZINTL_MACRO = "zintl";
export const RUNTIME_PACKAGE = "zintl";

export const TEMPLATE_ATTR_REGEX = /(alt|aria-label|title|placeholder)="([^"]+)"/g;
export const HTML_TAG_SPLIT_REGEX = /(<[^>]+>)/g;
