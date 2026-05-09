/** Precise source location for any code span. */
export interface SourceLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

/** Import specifier in an import declaration. */
export interface ImportSpecifier {
  local: string;
  imported: string;
  kind: "value" | "type";
}
