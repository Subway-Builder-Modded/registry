import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";

const traverse = (
  (traverseImport as unknown as { default?: typeof traverseImport }).default
  ?? traverseImport
);

export interface AstScanContext {
  aliases: Map<string, string>;
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

function collectAliasMappings(ast: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  const mappings: Array<{ alias: string; target: string }> = [];

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

  return aliases;
}

export function createAstScanContext(sourceAst: unknown): AstScanContext {
  return {
    aliases: collectAliasMappings(sourceAst),
  };
}

export { traverse };

