import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";

const traverse = (
  (traverseImport as unknown as { default?: typeof traverseImport }).default
  ?? traverseImport
);

export interface AstScanContext {
  aliases: Map<string, string>;
  callArgCallFirstIndex: Map<string, number>;
  whileCallDirectFirstIndex: Map<string, number>;
  whileCallResolvedFirstIndex: Map<string, number>;
}

export function safeNodeStart(node: unknown): number {
  if (typeof node !== "object" || node === null) return -1;
  const raw = node as { start?: unknown };
  return typeof raw.start === "number" ? raw.start : -1;
}

export function getCalleeName(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const typed = node as {
    type?: unknown;
    name?: unknown;
    computed?: unknown;
    property?: unknown;
  };
  if (typed.type === "Identifier" && typeof typed.name === "string") {
    return typed.name;
  }
  if (
    (typed.type === "MemberExpression" || typed.type === "OptionalMemberExpression")
    && typed.computed !== true
    && typeof typed.property === "object"
    && typed.property !== null
    && (typed.property as { type?: unknown }).type === "Identifier"
  ) {
    const propertyName = (typed.property as { name?: unknown }).name;
    return typeof propertyName === "string" ? propertyName : null;
  }
  return null;
}

export function parseSourceAst(source: string): unknown | null {
  try {
    return parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
      ],
    });
  } catch {
    return null;
  }
}

export function resolveAliasName(name: string, aliases: Map<string, string>): string {
  let current = name;
  const visited = new Set<string>();
  while (aliases.has(current) && !visited.has(current)) {
    visited.add(current);
    current = aliases.get(current) ?? current;
  }
  return current;
}

function resolveExpressionName(expression: unknown): string | null {
  return getCalleeName(expression);
}

function getOrSetFirstIndex(indexMap: Map<string, number>, key: string, index: number): void {
  if (!Number.isFinite(index) || index < 0) return;
  const current = indexMap.get(key);
  if (typeof current === "number" && current <= index) return;
  indexMap.set(key, index);
}

function buildAstIndexes(ast: unknown): {
  aliases: Map<string, string>;
  callArgCallFirstIndex: Map<string, number>;
  whileCallDirectFirstIndex: Map<string, number>;
} {
  const aliases = new Map<string, string>();
  const mappings: Array<{ alias: string; target: string }> = [];
  const callArgCallFirstIndex = new Map<string, number>();
  const whileCallDirectFirstIndex = new Map<string, number>();

  traverse(ast as any, {
    VariableDeclarator(path: any) {
      const node = path.node as {
        id?: unknown;
        init?: unknown;
      };
      if (
        typeof node.id !== "object"
        || node.id === null
        || (node.id as { type?: unknown }).type !== "Identifier"
      ) {
        return;
      }
      const alias = (node.id as { name?: unknown }).name;
      if (typeof alias !== "string") return;
      const target = resolveExpressionName(node.init);
      if (!target) return;
      mappings.push({ alias, target });
    },
    AssignmentExpression(path: any) {
      const node = path.node as {
        left?: unknown;
        right?: unknown;
      };
      if (
        typeof node.left !== "object"
        || node.left === null
        || (node.left as { type?: unknown }).type !== "Identifier"
      ) {
        return;
      }
      const alias = (node.left as { name?: unknown }).name;
      if (typeof alias !== "string") return;
      const target = resolveExpressionName(node.right);
      if (!target) return;
      mappings.push({ alias, target });
    },
    CallExpression(path: any) {
      const node = path.node as {
        callee?: unknown;
        arguments?: unknown[];
      };

      const calleeName = getCalleeName(node.callee);
      if (calleeName) {
        const firstArg = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
        if (
          typeof firstArg === "object"
          && firstArg !== null
          && (firstArg as { type?: unknown }).type === "CallExpression"
        ) {
          const argCalleeName = getCalleeName((firstArg as { callee?: unknown }).callee);
          if (argCalleeName) {
            getOrSetFirstIndex(
              callArgCallFirstIndex,
              `${calleeName}::${argCalleeName}`,
              safeNodeStart(path.node),
            );
          }
        }

        const isInsideWhile = path.findParent((parentPath: any) => {
          const parentNode = parentPath?.node as { type?: unknown } | undefined;
          return parentNode?.type === "WhileStatement";
        });
        if (isInsideWhile) {
          getOrSetFirstIndex(
            whileCallDirectFirstIndex,
            calleeName,
            safeNodeStart(path.node),
          );
        }
      }
    },
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const mapping of mappings) {
      const resolvedTarget = resolveAliasName(mapping.target, aliases);
      const current = aliases.get(mapping.alias);
      if (current !== resolvedTarget) {
        aliases.set(mapping.alias, resolvedTarget);
        changed = true;
      }
    }
  }

  return {
    aliases,
    callArgCallFirstIndex,
    whileCallDirectFirstIndex,
  };
}

export function createAstScanContext(sourceAst: unknown): AstScanContext {
  const {
    aliases,
    callArgCallFirstIndex,
    whileCallDirectFirstIndex,
  } = buildAstIndexes(sourceAst);
  const whileCallResolvedFirstIndex = new Map<string, number>();
  for (const [directName, index] of whileCallDirectFirstIndex.entries()) {
    const resolved = resolveAliasName(directName, aliases);
    getOrSetFirstIndex(whileCallResolvedFirstIndex, resolved, index);
  }

  return {
    aliases,
    callArgCallFirstIndex,
    whileCallDirectFirstIndex,
    whileCallResolvedFirstIndex,
  };
}

export { traverse };

