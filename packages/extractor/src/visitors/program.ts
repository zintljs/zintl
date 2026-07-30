import type { Node, CallExpression, ImportDeclaration } from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { ZINTL_MACRO, isRuntimeSpecifier } from "../constants.js";
import { generateMessageId } from "../hashing.js";
import { walk, Visitors } from "../walker.js";
import { getAttachedComments } from "../comments.js";

const GLOBALS = new Set([
  "window",
  "document",
  "location",
  "URLSearchParams",
  "localStorage",
  "navigator",
  "history",
  "Intl",
  "console",
]);

function checkSuppression(
  node: any,
  ctx: ExtractionContext,
  parents: any[],
  isInitStart?: number,
): boolean {
  if (ctx.suppressionRules.length === 0) return false;
  if (!node.id || node.id.type !== "Identifier") return false;

  const name = node.id.name;

  for (const rule of ctx.suppressionRules) {
    if (!rule.match.types.includes(node.type)) continue;
    if (!rule.match.names.includes(name)) continue;
    if (rule.match.isTopLevel && !isTopLevelDecl(parents)) continue;

    if (rule.bypassIf === "hasAnchor") {
      const initStart = isInitStart !== undefined ? isInitStart : node.start;
      const hasAnchor =
        ctx.hasTopLevelAnchor ||
        ((ctx.hasZintlMacro || ctx.hasZintlMarker) &&
          (ctx.scopeBoundaries.has(node.start) || ctx.scopeBoundaries.has(initStart)));
      if (hasAnchor) {
        continue;
      }
    }

    return true;
  }
  return false;
}

function isTopLevelDecl(parents: Node[]): boolean {
  for (const p of parents) {
    if (
      p.type === "FunctionDeclaration" ||
      p.type === "FunctionExpression" ||
      p.type === "ArrowFunctionExpression" ||
      p.type === "MethodDefinition" ||
      p.type === "ClassBody"
    ) {
      return false;
    }
  }
  return true;
}

const SCOPE_TYPES = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "BlockStatement",
]);

export function createProgramVisitor(_ctx: ExtractionContext): Visitors {
  function getAnchorInfo(node: Node, parents: Node[]) {
    let isAnchor = false,
      isTopLevel = false,
      current = node,
      idx = 0;
    while (idx < parents.length) {
      const parent = parents[idx];
      if (
        parent.type === "AwaitExpression" ||
        (parent.type === "UnaryExpression" && parent.operator === "void") ||
        (parent.type === "MemberExpression" &&
          !parent.computed &&
          parent.property.type === "Identifier" &&
          parent.property.name === "then") ||
        (parent.type === "CallExpression" && parent.callee === current)
      ) {
        current = parent;
        idx++;
      } else break;
    }
    const immediateParent = parents[idx];
    let statementRange: { start: number; end: number } | undefined;
    if (immediateParent) {
      if (
        [
          "ExpressionStatement",
          "ArrowFunctionExpression",
          "ReturnStatement",
          "BlockStatement",
          "VariableDeclarator",
        ].includes(immediateParent.type)
      ) {
        isAnchor = true;
        // If it's a standalone statement, we want to capture its full range to allow total removal
        if (immediateParent.type === "ExpressionStatement") {
          statementRange = { start: immediateParent.start, end: immediateParent.end };
        } else {
          // If it's part of a return or arrow body, we at least include the await/wrappers
          statementRange = { start: current.start, end: current.end };
        }

        let stmtIdx = idx;
        while (stmtIdx < parents.length) {
          const p = parents[stmtIdx];
          if (p.type === "Program") {
            isTopLevel = true;
            break;
          }
          if (p.type === "BlockStatement") break;
          stmtIdx++;
        }
      }
    }
    return { isAnchor, isTopLevel, statementRange };
  }

  const scopeCache = new Map<any, Map<string, { stmt: any; decl: any }>>();

  const getScopeDecls = (scope: any) => {
    if (scopeCache.has(scope)) return scopeCache.get(scope)!;
    const decls = new Map<string, { stmt: any; decl: any }>();
    const body = scope.body?.type === "BlockStatement" ? scope.body.body : scope.body;
    if (Array.isArray(body)) {
      for (const stmt of body) {
        if (stmt.type === "VariableDeclaration") {
          for (const decl of stmt.declarations) {
            if (decl.id.type === "Identifier" && decl.init) {
              decls.set(decl.id.name, { stmt, decl });
            }
          }
        }
      }
    }
    scopeCache.set(scope, decls);
    return decls;
  };

  function traceIdentifier(
    name: string,
    parents: Node[],
    seen = new Set<string>(),
  ): string | undefined {
    if (seen.has(name) || GLOBALS.has(name)) return undefined;
    seen.add(name);

    for (let i = 0; i < parents.length; i++) {
      const p = parents[i];
      if (!SCOPE_TYPES.has(p.type)) continue;

      const decls = getScopeDecls(p);
      const entry = decls.get(name);

      if (entry) {
        const { stmt, decl } = entry;
        let code = _ctx.code.slice(stmt.start, stmt.end);
        if (!code.endsWith(";")) code += ";";

        const deps: string[] = [];
        const extractIds = (n: any) => {
          if (!n || typeof n !== "object") return;
          if (n.type === "Identifier") deps.push(n.name);
          for (const key in n) {
            if (n.type === "MemberExpression" && key === "property" && !n.computed) continue;
            const val = (n as any)[key];
            if (val && typeof val === "object") {
              if (Array.isArray(val)) val.forEach(extractIds);
              else extractIds(val);
            }
          }
        };
        extractIds(decl.init);

        const results: string[] = [];
        for (const dep of deps) {
          const depCode = traceIdentifier(dep, parents.slice(i), seen);
          if (depCode) results.push(depCode);
        }
        results.push(code);
        return results.join("\n");
      }
    }

    return undefined;
  }

  return {
    Program: {
      enter(node: Node, ctx: ExtractionContext) {
        if (ctx.isZeroConfig) ctx.boundaryStack[0].active = true;

        // Fast-path: If the file has no tokens that could produce sinks or anchors,
        // skip the expensive recursive walk entirely.
        // The regex is derived from the active target configuration — no hardcoded framework strings.
        const hasMaybeUI = ctx.fastPathRegex.test(ctx.code);
        const hasDynamicImport = ctx.code.includes("import(");
        if (!hasMaybeUI && !hasDynamicImport) {
          // Fast-path: Still identify top-level functions for potential cross-file references,
          // and extract imports/dependencies, but skip the expensive recursive walk for sinks and anchors.
          for (const stmt of (node as any).body) {
            const register = (fn: any, name: string) => {
              if (
                fn &&
                ["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(
                  fn.type,
                )
              ) {
                if (ctx.isZeroConfig) {
                  const bId = `${ctx.fileBoundaryId}:${name}`;
                  ctx.scopeBoundaries.set(fn.start, bId);
                  ctx.localBoundaries.set(name, bId);
                }
              }
            };
            if (stmt.type === "ImportDeclaration") {
              if (["StringLiteral", "Literal"].includes(stmt.source.type)) {
                const sourceVal = (stmt.source as any).value,
                  bindings: string[] = [];
                if (stmt.specifiers)
                  for (const spec of stmt.specifiers) {
                    if (spec.type === "ImportSpecifier")
                      bindings.push((spec.imported as any).name || (spec.imported as any).value);
                    else if (spec.type === "ImportDefaultSpecifier") bindings.push("default");
                  }
                if (isRuntimeSpecifier(sourceVal, ctx.runtimePackage)) {
                  ctx.zintlImportGroup = { start: stmt.start, end: stmt.end, source: sourceVal };
                  for (const name of bindings) ctx.runtimeImports.push(name);
                  if (!stmt.specifiers?.length) {
                    ctx.mode = "entry";
                    ctx.hasZintlMarker = true;
                  }
                }
                ctx.addDependency(sourceVal, false, bindings);
              }
            } else if (stmt.type === "FunctionDeclaration" && stmt.id) register(stmt, stmt.id.name);
            else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
              const decl = stmt.declaration;
              if (decl.type === "FunctionDeclaration" && decl.id) {
                register(decl, decl.id.name);
                ctx.exportedBoundaries.set(decl.id.name, `${ctx.fileBoundaryId}:${decl.id.name}`);
              } else if (decl.type === "VariableDeclaration") {
                for (const d of decl.declarations) {
                  if (d.id.type === "Identifier" && d.init) {
                    register(d.init, d.id.name);
                    ctx.exportedBoundaries.set(d.id.name, `${ctx.fileBoundaryId}:${d.id.name}`);
                  }
                }
              }
            } else if (stmt.type === "ExportDefaultDeclaration") {
              register(stmt.declaration, "default");
              ctx.exportedBoundaries.set("default", `${ctx.fileBoundaryId}:default`);
            }
          }
          return;
        }

        const topLevelAnchors: CallExpression[] = [],
          functionalAnchors: { node: CallExpression; fnParent: Node }[] = [];
        walk(
          node,
          {
            CallExpression(child: CallExpression, _ctx: ExtractionContext, parents: Node[]) {
              const isZintl =
                child.callee.type === "Identifier" && child.callee.name === ZINTL_MACRO;
              const isLoader =
                child.callee.type === "Identifier" && child.callee.name === "loadI18nInstance";
              if (isZintl || isLoader) {
                if (isZintl) _ctx.hasZintlMacro = true;
                const anchorInfo = getAnchorInfo(child, parents);
                if (anchorInfo.isAnchor) {
                  if (anchorInfo.isTopLevel) topLevelAnchors.push(child);
                  else {
                    const fnParent = parents.find((p) =>
                      [
                        "FunctionDeclaration",
                        "FunctionExpression",
                        "ArrowFunctionExpression",
                        "MethodDefinition",
                      ].includes(p.type),
                    );
                    if (fnParent) functionalAnchors.push({ node: child, fnParent });
                  }
                }
              }
            },
          } as any,
          ctx,
        );

        for (const { node: anchorNode, fnParent } of functionalAnchors) {
          let fnId =
            (fnParent.type === "FunctionDeclaration" && fnParent.id?.name) ||
            (fnParent.type === "MethodDefinition" &&
              fnParent.key.type === "Identifier" &&
              (fnParent.key as any).name) ||
            `f_${(anchorNode as any).start}`;
          const bId = `${ctx.fileBoundaryId}:${fnId}`;
          ctx.scopeBoundaries.set(fnParent.start, bId);
          if (fnParent.type === "FunctionDeclaration" && fnParent.id)
            ctx.localBoundaries.set(fnParent.id.name, bId);
        }

        // Structural boundary assignment — no sink speculation, no recursive walk.
        //
        // Rule: every top-level EXPORTED function gets its own sub-boundary so that
        // the compiler's binding tracker can attribute strings precisely when a
        // consumer imports only a subset of the file's exports.
        // In zero-config mode ALL top-level functions get boundaries (mirrors the
        // fast-path registration that runs when !hasMaybeUI).
        const assignBoundary = (fn: any, name: string) => {
          if (
            !fn ||
            !["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(
              fn.type,
            )
          )
            return;
          if (ctx.scopeBoundaries.has(fn.start)) return; // already set by a functional anchor
          const bId = `${ctx.fileBoundaryId}:${name}`;
          ctx.scopeBoundaries.set(fn.start, bId);
          ctx.localBoundaries.set(name, bId);
        };

        for (const stmt of (node as any).body) {
          if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
            if (stmt.declaration.type === "FunctionDeclaration" && stmt.declaration.id) {
              assignBoundary(stmt.declaration, stmt.declaration.id.name);
            } else if (stmt.declaration.type === "VariableDeclaration") {
              for (const decl of stmt.declaration.declarations) {
                if (decl.id.type === "Identifier" && decl.init) {
                  assignBoundary(decl.init, decl.id.name);
                }
              }
            }
          } else if (stmt.type === "ExportDefaultDeclaration") {
            assignBoundary(stmt.declaration, "default");
          } else if (ctx.isZeroConfig) {
            // Zero-config: also register non-exported top-level functions
            if (stmt.type === "FunctionDeclaration" && stmt.id) {
              assignBoundary(stmt, stmt.id.name);
            } else if (stmt.type === "VariableDeclaration") {
              for (const decl of stmt.declarations) {
                if (decl.id.type === "Identifier" && decl.init) {
                  assignBoundary(decl.init, decl.id.name);
                }
              }
            }
          }
        }

        if (topLevelAnchors.length > 0) {
          ctx.hasTopLevelAnchor = true;
          ctx.scopeBoundaries.set(node.start, ctx.fileBoundaryId);
        }

        for (const stmt of (node as any).body) {
          if (stmt.type === "ExportNamedDeclaration") {
            if (stmt.declaration) {
              if (stmt.declaration.type === "FunctionDeclaration" && stmt.declaration.id) {
                const name = stmt.declaration.id.name;
                const bId =
                  ctx.scopeBoundaries.get(stmt.declaration.start) ||
                  ctx.localBoundaries.get(name) ||
                  ctx.fileBoundaryId;
                ctx.exportedBoundaries.set(name, bId);
              } else if (stmt.declaration.type === "VariableDeclaration") {
                for (const decl of stmt.declaration.declarations) {
                  if (decl.id.type === "Identifier") {
                    const name = decl.id.name;
                    const bId =
                      (decl.init && ctx.scopeBoundaries.get(decl.init.start)) ||
                      ctx.localBoundaries.get(name) ||
                      ctx.fileBoundaryId;
                    ctx.exportedBoundaries.set(name, bId);
                  }
                }
              }
            } else if (stmt.specifiers) {
              for (const spec of stmt.specifiers) {
                const localName = spec.local.name;
                const exportedName = spec.exported.name;
                const bId = ctx.localBoundaries.get(localName) || ctx.fileBoundaryId;
                ctx.exportedBoundaries.set(exportedName, bId);
              }
            }
          } else if (stmt.type === "ExportDefaultDeclaration") {
            let bId = ctx.fileBoundaryId;
            const decl = stmt.declaration;
            if (decl.type === "Identifier") {
              bId = ctx.localBoundaries.get(decl.name) || ctx.fileBoundaryId;
            } else if (decl.type === "FunctionDeclaration" && decl.id) {
              bId =
                ctx.scopeBoundaries.get(decl.start) ||
                ctx.localBoundaries.get(decl.id.name) ||
                ctx.fileBoundaryId;
            } else {
              bId = ctx.scopeBoundaries.get(decl.start) || ctx.fileBoundaryId;
            }
            ctx.exportedBoundaries.set("default", bId);
          }
        }
      },
    },
    FunctionDeclaration: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) ctx.pushSuppression(comments);

        const isMetadata = checkSuppression(node, ctx, parents);
        if (isMetadata) {
          ctx.suppressionLevel++;
          node.__zintl_suppressed = true;
        }

        const pb = ctx.getActiveBoundary(),
          id = ctx.scopeBoundaries.get(node.start);
        ctx.boundaryStack.push({ id: id || pb.id, active: id ? true : pb.active });
      },
      exit(node: any, ctx: ExtractionContext, parents: Node[]) {
        ctx.popSuppression(getAttachedComments(node, parents, ctx.trivias, ctx.code));
        if (node.__zintl_suppressed) {
          ctx.suppressionLevel--;
        }
        ctx.boundaryStack.pop();
      },
    },
    FunctionExpression: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) ctx.pushSuppression(comments);
        const pb = ctx.getActiveBoundary(),
          id = ctx.scopeBoundaries.get(node.start);
        ctx.boundaryStack.push({ id: id || pb.id, active: id ? true : pb.active });
      },
      exit(node: any, ctx: ExtractionContext, parents: Node[]) {
        ctx.popSuppression(getAttachedComments(node, parents, ctx.trivias, ctx.code));
        ctx.boundaryStack.pop();
      },
    },
    ArrowFunctionExpression: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) ctx.pushSuppression(comments);
        const pb = ctx.getActiveBoundary(),
          id = ctx.scopeBoundaries.get(node.start);
        ctx.boundaryStack.push({ id: id || pb.id, active: id ? true : pb.active });
      },
      exit(node: any, ctx: ExtractionContext, parents: Node[]) {
        ctx.popSuppression(getAttachedComments(node, parents, ctx.trivias, ctx.code));
        ctx.boundaryStack.pop();
      },
    },
    VariableDeclarator: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const isMetadata = checkSuppression(node, ctx, parents, node.init?.start);
        if (isMetadata) {
          ctx.suppressionLevel++;
          node.__zintl_suppressed = true;
        }
      },
      exit(node: any, ctx: ExtractionContext, _parents: Node[]) {
        if (node.__zintl_suppressed) {
          ctx.suppressionLevel--;
        }
      },
    },
    CallExpression(node: CallExpression, ctx: ExtractionContext, parents: Node[]) {
      if (ctx.suppressionLevel > 0) return;
      if (node.callee.type === "Identifier") {
        const lbId = ctx.localBoundaries.get(node.callee.name);
        if (lbId) ctx.addInternalDependency(lbId);
      }
      const isZintl = node.callee.type === "Identifier" && node.callee.name === ZINTL_MACRO;
      const isLoader = node.callee.type === "Identifier" && node.callee.name === "loadI18nInstance";
      if (isZintl || isLoader) {
        const anchorInfo = getAnchorInfo(node, parents);
        if (!anchorInfo.isAnchor) return;
        const { isTopLevel } = anchorInfo;
        if (
          isLoader &&
          node.arguments[0]?.type === "ObjectExpression" &&
          (node.arguments[0] as any).properties.some((p: any) => p.key.name === "loaders")
        )
          return;
        if (isZintl) ctx.hasZintlMacro = true;
        if (isTopLevel) ctx.mode = "entry";
        let originalArgs = "",
          argType: "literal" | "expression" = "expression";
        if (node.arguments[0]) {
          originalArgs = ctx.code.slice(node.arguments[0].start, node.arguments[0].end);
          if (["StringLiteral", "Literal"].includes(node.arguments[0].type)) argType = "literal";
        }
        ctx.anchorSites.push({
          start: node.start,
          end: node.end,
          scope: isTopLevel ? "module" : "function",
          boundaryId: ctx.getActiveBoundary().id,
          originalArgs,
          argType,
          isTopLevel,
          originalName: (node.callee as any).name,
          statementRange: anchorInfo.statementRange,
          detectionCode: (() => {
            if (argType !== "expression" || !node.arguments[0]) return undefined;
            const ids = new Set<string>();
            const collectIds = (n: any) => {
              if (!n || typeof n !== "object") return;
              if (n.type === "Identifier") ids.add(n.name);
              for (const k in n) {
                if (n.type === "MemberExpression" && k === "property" && !n.computed) continue;
                const v = n[k];
                if (Array.isArray(v)) v.forEach(collectIds);
                else if (v && typeof v === "object") collectIds(v);
              }
            };
            collectIds(node.arguments[0]);
            const results = new Set<string>();
            for (const id of ids) {
              const code = traceIdentifier(id, parents);
              if (code) results.add(code);
            }
            return results.size > 0 ? Array.from(results).join("\n") : undefined;
          })(),
        });
        ctx.getActiveBoundary().active = true;
      } else if (node.callee.type === "Identifier" && node.callee.name === "t") {
        ctx.registerComponentFunction(parents);
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) return;
        if (node.arguments[0] && ["StringLiteral", "Literal"].includes(node.arguments[0].type)) {
          const text = (node.arguments[0] as any).value;
          ctx.usedKeys.add(generateMessageId(text, "Manual"));
          ctx.rawManualTranslations.push({
            start: node.start,
            end: node.end,
            key: text,
            line: node.start,
            column: node.start,
            boundaryId: ctx.getActiveBoundary().id,
            paramsSource:
              node.arguments.length > 1
                ? ctx.code.slice(
                    node.arguments[1].start,
                    node.arguments[node.arguments.length - 1].end,
                  )
                : undefined,
          });
        }
      }
    },
    ImportExpression(node: any, ctx: ExtractionContext) {
      if (node.source && ["StringLiteral", "Literal"].includes(node.source.type))
        ctx.addDependency(node.source.value, true);
    },
    ImportDeclaration(node: ImportDeclaration, ctx: ExtractionContext) {
      if (["StringLiteral", "Literal"].includes(node.source.type)) {
        const sourceVal = (node.source as any).value,
          bindings: string[] = [];
        if (node.specifiers)
          for (const spec of node.specifiers) {
            if (spec.type === "ImportSpecifier")
              bindings.push((spec.imported as any).name || (spec.imported as any).value);
            else if (spec.type === "ImportDefaultSpecifier") bindings.push("default");
          }
        if (isRuntimeSpecifier(sourceVal, ctx.runtimePackage)) {
          ctx.zintlImportGroup = { start: node.start, end: node.end, source: sourceVal };
          for (const name of bindings) ctx.runtimeImports.push(name);
          if (!node.specifiers?.length) {
            ctx.mode = "entry";
            ctx.hasZintlMarker = true;
          }
        }
        ctx.addDependency(sourceVal, false, bindings);
      }
    },
  } as Visitors;
}
