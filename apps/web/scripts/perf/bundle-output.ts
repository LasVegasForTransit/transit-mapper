import { posix } from 'node:path';

export type BundleOutputFiles = Readonly<Partial<Record<string, Uint8Array>>>;

export function emittedSource(path: string, files: BundleOutputFiles): string {
  const contents = files[path];
  if (!contents) throw new Error(`Build output "${path}" does not exist.`);
  return Buffer.from(contents).toString('utf8');
}

export function resolvedOutputReference(
  reference: string,
  ownerPath: string,
  files: BundleOutputFiles,
): string {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const path = withoutQuery.startsWith('/')
    ? withoutQuery.replace(/^\/+/, '')
    : posix.normalize(posix.join(posix.dirname(ownerPath), withoutQuery));
  if (files[path]) return path;
  const withExtension = `${path}.js`;
  if (!posix.extname(path) && files[withExtension]) return withExtension;
  throw new Error(`Build output "${ownerPath}" references missing file "${reference}".`);
}

export function moduleReferences(source: string): string[] {
  const references = [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1/g,
    ),
  ].map((match) => match[2]);
  return [...new Set(references)];
}
