import { parse } from 'acorn';

/** Bundled PR code may reference platform builtins, never runner files or computed imports. */
export function verifyPreviewModuleImports(source: string): void {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(String(node.type)) &&
      node.source
    ) {
      const specifier = node.source as Record<string, unknown>;
      if (
        specifier.type !== 'Literal' ||
        typeof specifier.value !== 'string' ||
        !/^(node|cloudflare):[a-zA-Z0-9_/-]+$/.test(specifier.value)
      )
        throw new Error('PR preview imports must be bundled or use platform builtins.');
    }
    Object.values(node).forEach(visit);
  };
  visit(tree);
}
