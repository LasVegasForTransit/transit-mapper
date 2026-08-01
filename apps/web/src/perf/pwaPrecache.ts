export interface BuildManifestEntry {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export type BuildManifest = Record<string, BuildManifestEntry>;

export interface WebAppManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

export interface WebAppManifest {
  icons?: WebAppManifestIcon[];
}

export interface VerifyPrecacheOutputOptions {
  manifest: BuildManifest;
  installIcons: readonly string[];
  precached: string[];
}

/**
 * Fingerprinted assets referenced from emitted JavaScript or CSS.
 *
 * `woff2?` is deliberate: putting `woff` before `woff2` in an alternation
 * accepts the shorter prefix and silently turns a `.woff2` URL into `.woff`.
 */
export function referencedBuildAssetFiles(source: string): string[] {
  return [
    ...source.matchAll(/(?:^|["'(])\/?(assets\/[A-Za-z0-9_.@-]+\.(?:js|css|png|svg|webp|woff2?))/g),
  ].map((match) => match[1]);
}

const EDITOR_PUBLIC_ASSETS = [
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-dark-16x16.png',
  'favicon-dark-32x32.png',
  'favicon.svg',
  'manifest.json',
] as const;

function entryKey(manifest: BuildManifest, name: 'main' | 'embed'): string {
  const match = Object.entries(manifest).find(
    ([key, entry]) =>
      entry.isEntry &&
      (entry.name === name || (name === 'main' ? key === 'index.html' : key === 'embed.html')),
  );
  if (!match) throw new Error(`Vite manifest has no ${name} entry.`);
  return match[0];
}

function collectManifestGraph(
  key: string,
  manifest: BuildManifest,
  files: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`Vite manifest import "${key}" does not exist.`);
  files.add(entry.file);
  for (const file of entry.css ?? []) files.add(file);
  for (const file of entry.assets ?? []) files.add(file);
  for (const importedKey of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
    collectManifestGraph(importedKey, manifest, files, visited);
  }
}

function entryGraph(manifest: BuildManifest, name: 'main' | 'embed'): Set<string> {
  const key = entryKey(manifest, name);
  const files = new Set<string>([key]);
  collectManifestGraph(key, manifest, files, new Set());
  return files;
}

export function manifestInstallIconFiles(manifest: WebAppManifest): string[] {
  return [
    ...new Set((manifest.icons ?? []).map((icon) => icon.src.replace(/^\/+/, '')).filter(Boolean)),
  ].sort();
}

export function editorPrecacheFiles(
  manifest: BuildManifest,
  installIcons: readonly string[],
): string[] {
  return [...entryGraph(manifest, 'main'), ...EDITOR_PUBLIC_ASSETS, ...installIcons].sort();
}

export function embedOnlyFiles(manifest: BuildManifest, installIcons: readonly string[]): string[] {
  const editorFiles = new Set(editorPrecacheFiles(manifest, installIcons));
  return [...entryGraph(manifest, 'embed')].filter((file) => !editorFiles.has(file)).sort();
}

export function verifyPrecacheOutput(options: VerifyPrecacheOutputOptions): string[] {
  const precached = new Set(options.precached);
  const failures = editorPrecacheFiles(options.manifest, options.installIcons)
    .filter((file) => !precached.has(file))
    .map((file) => `editor asset is not precached: ${file}`);

  failures.push(
    ...embedOnlyFiles(options.manifest, options.installIcons)
      .filter((file) => precached.has(file))
      .map((file) => `embed-only asset is precached: ${file}`),
  );

  return failures;
}
