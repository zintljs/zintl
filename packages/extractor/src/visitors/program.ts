import type { Node, CallExpression, ImportDeclaration } from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { ZINTL_MACRO } from "../constants.js";
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

        const hasMaybeUI = /zintl|loadI18nInstance|t\(|<|innerHTML/.test(ctx.code);
        if (!hasMaybeUI) {
          // Fast-path: Still identify top-level functions for potential cross-file references,
          // but skip the expensive recursive walk for sinks and anchors.
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
            if (stmt.type === "FunctionDeclaration" && stmt.id) register(stmt, stmt.id.name);
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

        const hasSinksOrCalls = (node: any, seen = new Set()): boolean => {
          if (!node || typeof node !== "object" || seen.has(node)) return false;
          seen.add(node);
          if (
            node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "t"
          )
            return true;
          if (node.type === "JSXElement" || node.type === "JSXFragment") return true;
          if (
            node.type === "AssignmentExpression" &&
            node.left?.type === "MemberExpression" &&
            ["innerHTML", "innerText"].includes(node.left.property?.name)
          )
            return true;
          const childrenProps = [
            "body",
            "statements",
            "argument",
            "declarations",
            "init",
            "expression",
            "callee",
            "arguments",
            "properties",
            "elements",
            "left",
            "right",
            "value",
          ];
          for (const prop of childrenProps) {
            const val = node[prop];
            if (!val) continue;
            if (Array.isArray(val)) {
              if (val.some((v) => hasSinksOrCalls(v, seen))) return true;
            } else if (hasSinksOrCalls(val, seen)) return true;
          }
          return false;
        };

        const topLevelFunctions = new Map<any, string>();
        const registerIfFunction = (node: any, name: string) => {
          if (
            node &&
            ["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(
              node.type,
            )
          ) {
            topLevelFunctions.set(node, name);
          }
        };

        for (const stmt of (node as any).body) {
          if (stmt.type === "FunctionDeclaration" && stmt.id) {
            registerIfFunction(stmt, stmt.id.name);
          } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
            if (stmt.declaration.type === "FunctionDeclaration" && stmt.declaration.id) {
              registerIfFunction(stmt.declaration, stmt.declaration.id.name);
            } else if (stmt.declaration.type === "VariableDeclaration") {
              for (const decl of stmt.declaration.declarations) {
                if (decl.id.type === "Identifier" && decl.init) {
                  registerIfFunction(decl.init, decl.id.name);
                }
              }
            }
          } else if (stmt.type === "ExportDefaultDeclaration") {
            registerIfFunction(stmt.declaration, "default");
          } else if (stmt.type === "VariableDeclaration") {
            for (const decl of stmt.declarations) {
              if (decl.id.type === "Identifier" && decl.init) {
                registerIfFunction(decl.init, decl.id.name);
              }
            }
          }
        }

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

        for (const [fnNode, fnId] of topLevelFunctions.entries()) {
          if (!ctx.scopeBoundaries.has(fnNode.start) && hasSinksOrCalls(fnNode)) {
            const bId = `${ctx.fileBoundaryId}:${fnId}`;
            ctx.scopeBoundaries.set(fnNode.start, bId);
            ctx.localBoundaries.set(fnId, bId);
          }
        }

        if (topLevelAnchors.length > 0) {
          ctx.hasTopLevelAnchor = true;
          ctx.scopeBoundaries.set(node.start, ctx.fileBoundaryId);
        }

        for (const stmt of (node as any).body) {
          if (stmt.type === "ExportNamedDeclaration") {
            if (stmt.declaration?.type === "FunctionDeclaration" && stmt.declaration.id)
              ctx.exportedBoundaries.set(
                stmt.declaration.id.name,
                ctx.scopeBoundaries.get(stmt.declaration.start) || ctx.fileBoundaryId,
              );
            else if (stmt.declaration?.type === "VariableDeclaration") {
              for (const decl of stmt.declaration.declarations)
                if (decl.id.type === "Identifier")
                  ctx.exportedBoundaries.set(
                    decl.id.name,
                    (decl.init && ctx.scopeBoundaries.get(decl.init.start)) || ctx.fileBoundaryId,
                  );
            }
          } else if (stmt.type === "ExportDefaultDeclaration")
            ctx.exportedBoundaries.set(
              "default",
              ctx.scopeBoundaries.get(stmt.declaration.start) || ctx.fileBoundaryId,
            );
        }
      },
    },
    FunctionDeclaration: {
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
        if ([ZINTL_MACRO, "zintl", "zintl/internal", ctx.runtimePackage].includes(sourceVal)) {
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
