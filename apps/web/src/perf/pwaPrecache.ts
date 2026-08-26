interface BuildManifestEntry {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export type BuildManifest = Record<string, BuildManifestEntry | undefined>;

interface WebAppManifestIcon {
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
  offlineRuntimeFiles?: readonly string[];
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

/** These three ranges cover the editor's Latin labels and the box-drawing
 * glyphs used by the transit map. All other glyph files stay lazy so first
 * install does not download a font archive for scripts the system never uses. */
export const OFFLINE_GLYPH_RANGE_FILES = [
  'glyphs/noto-sans-v1/Noto Sans Bold/0-255.pbf',
  'glyphs/noto-sans-v1/Noto Sans Regular/0-255.pbf',
  'glyphs/noto-sans-v1/Noto Sans Regular/9472-9727.pbf',
] as const;

const EDITOR_ESSENTIAL_PUBLIC_ASSETS = [
  'favicon.svg',
  'manifest.json',
  ...OFFLINE_GLYPH_RANGE_FILES,
] as const;

const EDITOR_ADAPTIVE_PUBLIC_ASSETS = [
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-dark-16x16.png',
  'favicon-dark-32x32.png',
] as const;

const EDITOR_DOCUMENT_FILE = 'index.html';
const EMBED_DOCUMENT_FILE = 'embed.html';

/** Vite emits these workers as asset URLs rather than manifest imports. The
 * editor needs them to read a saved system, lay it out, and project map
 * features after the network disappears. */
const OFFLINE_EDITOR_WORKER_PREFIXES = [
  'assets/diagram-layout-worker-entry-',
  'assets/feature-projection-worker-entry-',
  'assets/storage-deserializer-worker-',
] as const;

export const OFFLINE_EDITOR_ENTRY_NAME = 'offline-editor';
const EDITOR_APPLICATION_ENTRY_NAME = 'editor-application';

type BuildEntryName = 'main' | 'embed' | typeof OFFLINE_EDITOR_ENTRY_NAME;

function entryKey(manifest: BuildManifest, name: BuildEntryName): string {
  const match = Object.entries(manifest).find(([, entry]) => entry?.isEntry && entry.name === name);
  if (!match) throw new Error(`Vite manifest has no ${name} entry.`);
  return match[0];
}

interface ManifestGraphContext {
  manifest: BuildManifest;
  files: Set<string>;
  visited: Set<string>;
  includeDynamicImports: boolean;
}

function collectManifestGraph(key: string, context: ManifestGraphContext): void {
  if (context.visited.has(key)) return;
  context.visited.add(key);
  const entry = context.manifest[key];
  if (!entry) throw new Error(`Vite manifest import "${key}" does not exist.`);
  context.files.add(entry.file);
  for (const file of entry.css ?? []) context.files.add(file);
  for (const file of entry.assets ?? []) context.files.add(file);
  const importedKeys = context.includeDynamicImports
    ? [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]
    : (entry.imports ?? []);
  for (const importedKey of importedKeys) {
    collectManifestGraph(importedKey, context);
  }
}

function entryGraph(
  manifest: BuildManifest,
  name: BuildEntryName,
  includeDynamicImports: boolean,
): Set<string> {
  const key = entryKey(manifest, name);
  const files = new Set<string>();
  collectManifestGraph(key, {
    manifest,
    files,
    visited: new Set(),
    includeDynamicImports,
  });
  return files;
}

/** The offline entry may cross one deferred boundary to the map driver so the
 * normal editor can keep MapLibre out of its shell bundle. That declared
 * runtime and its static imports are required offline. Feature-level dynamic
 * imports below the driver remain adaptive. */
function offlineEditorGraph(manifest: BuildManifest): Set<string> {
  const key = entryKey(manifest, OFFLINE_EDITOR_ENTRY_NAME);
  const entry = manifest[key];
  if (!entry) throw new Error(`Vite manifest import "${key}" does not exist.`);
  const files = entryGraph(manifest, OFFLINE_EDITOR_ENTRY_NAME, false);
  const context = {
    manifest,
    files,
    visited: new Set([key]),
    includeDynamicImports: false,
  };
  for (const importedKey of entry.dynamicImports ?? []) {
    collectManifestGraph(importedKey, context);
  }
  return files;
}

/** The route shell imports the editor host lazily. An installed release must
 * retain that host and its static closure, or its cached shell can request a
 * hashed startup chunk that the next deployment has already replaced. */
function editorApplicationGraph(manifest: BuildManifest): Set<string> {
  const mainKey = entryKey(manifest, 'main');
  const main = manifest[mainKey];
  if (!main) throw new Error(`Vite manifest import "${mainKey}" does not exist.`);
  const editorKey = (main.dynamicImports ?? []).find(
    (key) => manifest[key]?.name === EDITOR_APPLICATION_ENTRY_NAME,
  );
  if (!editorKey) throw new Error('Vite manifest has no editor application entry.');
  const files = new Set<string>();
  collectManifestGraph(editorKey, {
    manifest,
    files,
    visited: new Set(),
    includeDynamicImports: false,
  });
  return files;
}

export function manifestInstallIconFiles(manifest: WebAppManifest): string[] {
  return [
    ...new Set((manifest.icons ?? []).map((icon) => icon.src.replace(/^\/+/, '')).filter(Boolean)),
  ].sort();
}

export function editorPrecacheFiles(
  manifest: BuildManifest,
  _installIcons: readonly string[],
): string[] {
  return [
    EDITOR_DOCUMENT_FILE,
    ...entryGraph(manifest, 'main', false),
    ...EDITOR_ESSENTIAL_PUBLIC_ASSETS,
  ].sort();
}

function offlineEditorWorkerFiles(files: readonly string[]): string[] {
  return files
    .map((file) => file.replace(/^\/+/, ''))
    .filter(
      (file) =>
        file.endsWith('.js') &&
        OFFLINE_EDITOR_WORKER_PREFIXES.some((prefix) => file.startsWith(prefix)),
    )
    .sort();
}

/** The editor shell, the declared offline editor runtime, and the workers that
 * load a saved document into an editable map. Import, export, and preview
 * workers remain adaptive because offline map startup never invokes them. */
export function editorOfflinePrecacheFiles(
  manifest: BuildManifest,
  installIcons: readonly string[],
  outputFiles: readonly string[],
): string[] {
  return [
    ...new Set([
      ...editorPrecacheFiles(manifest, installIcons),
      ...editorApplicationGraph(manifest),
      ...offlineEditorGraph(manifest),
      ...offlineEditorWorkerFiles(outputFiles),
    ]),
  ].sort();
}

export function editorAdaptiveFiles(
  manifest: BuildManifest,
  installIcons: readonly string[],
  offlineRuntimeFiles: readonly string[] = [],
): string[] {
  const essential = new Set(
    editorOfflinePrecacheFiles(manifest, installIcons, offlineRuntimeFiles),
  );
  return [...entryGraph(manifest, 'main', true), ...EDITOR_ADAPTIVE_PUBLIC_ASSETS, ...installIcons]
    .filter((file) => !essential.has(file))
    .sort();
}

export function embedOnlyFiles(manifest: BuildManifest, installIcons: readonly string[]): string[] {
  const editorFiles = new Set([
    ...editorOfflinePrecacheFiles(manifest, installIcons, []),
    ...editorAdaptiveFiles(manifest, installIcons),
  ]);
  return [EMBED_DOCUMENT_FILE, ...entryGraph(manifest, 'embed', true)]
    .filter((file) => !editorFiles.has(file))
    .sort();
}

export function verifyPrecacheOutput(options: VerifyPrecacheOutputOptions): string[] {
  const precached = new Set(options.precached);
  const offlineRuntimeFiles = options.offlineRuntimeFiles ?? [];
  const failures = editorOfflinePrecacheFiles(
    options.manifest,
    options.installIcons,
    offlineRuntimeFiles,
  )
    .filter((file) => !precached.has(file))
    .map((file) => `essential editor asset is not precached: ${file}`);

  failures.push(
    ...editorAdaptiveFiles(options.manifest, options.installIcons, offlineRuntimeFiles)
      .filter((file) => precached.has(file))
      .map((file) => `adaptive editor asset is precached during first install: ${file}`),
  );

  failures.push(
    ...embedOnlyFiles(options.manifest, options.installIcons)
      .filter((file) => precached.has(file))
      .map((file) => `embed-only asset is precached: ${file}`),
  );

  return failures;
}
