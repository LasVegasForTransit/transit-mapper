import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

interface SyntaxNode {
  type: string;
  [key: string]: unknown;
}
function node(value: unknown): SyntaxNode | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) return;
  if (typeof value.type !== 'string') return;
  return value as SyntaxNode;
}
function rejectGlobalAccess(): never {
  throw new Error(
    'Shared read-only bindings require reviewed handler modules without global or unverified native binding imports.',
  );
}
function staticTarget(value: unknown): string {
  const target = node(value);
  if (target?.type !== 'Literal' || typeof target.value !== 'string') rejectGlobalAccess();
  return target.value;
}
function checkNativeDeclaration(current: SyntaxNode): void {
  if (!current.source || staticTarget(current.source) !== 'cloudflare:workers') return;
  if (
    current.type !== 'ImportDeclaration' ||
    !Array.isArray(current.specifiers) ||
    !current.specifiers.length
  )
    rejectGlobalAccess();
  for (const value of current.specifiers) {
    const specifier = node(value);
    if (specifier?.type !== 'ImportSpecifier' || node(specifier.imported)?.name !== 'DurableObject')
      rejectGlobalAccess();
  }
}
function checkDynamicImport(current: SyntaxNode): void {
  if (current.type === 'ImportExpression' && staticTarget(current.source) === 'cloudflare:workers')
    rejectGlobalAccess();
  const callee = node(current.callee);
  if (
    current.type !== 'CallExpression' ||
    callee?.type !== 'Identifier' ||
    !['require', '__require'].includes(String(callee.name))
  )
    return;
  const target: unknown = Array.isArray(current.arguments) ? current.arguments[0] : undefined;
  if (staticTarget(target) === 'cloudflare:workers') rejectGlobalAccess();
}
function visit(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child);
    return;
  }
  const current = node(value);
  if (!current) return;
  if (
    ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(current.type)
  )
    checkNativeDeclaration(current);
  checkDynamicImport(current);
  for (const child of Object.values(current)) visit(child);
}
export function assertReadOnlyWorkerModule(source: string): void {
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
}
async function verifyDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory)) {
    const file = path.join(directory, entry);
    const info = await lstat(file);
    if (info.isSymbolicLink()) rejectGlobalAccess();
    if (info.isDirectory()) await verifyDirectory(file);
    else if (/\.[cm]?js$/u.test(entry)) assertReadOnlyWorkerModule(await readFile(file, 'utf8'));
  }
}
export async function verifyReadOnlyWorkerModules(directory: string): Promise<void> {
  await verifyDirectory(path.join(directory, '.wrangler/worker'));
}
