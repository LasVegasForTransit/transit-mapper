import type { BuildManifest } from '../../src/perf/pwaPrecache';

const keys = {
  main: 'fixture:main',
  embed: 'fixture:embed',
  shared: 'fixture:shared',
  editorApplication: 'fixture:editor-application',
  offlineEditor: 'fixture:offline-editor',
  optionalFeature: 'fixture:optional-feature',
  offlineRuntime: 'fixture:offline-runtime',
  nestedOfflineRuntime: 'fixture:nested-offline-runtime',
  optionalOfflineFeature: 'fixture:optional-offline-feature',
} as const;

const files = {
  mainScript: 'build/main-script.js',
  mainStyles: 'build/main-styles.css',
  sharedScript: 'build/shared-script.js',
  sharedStyles: 'build/shared-styles.css',
  editorApplicationScript: 'build/editor-application.js',
  offlineEditorScript: 'build/offline-editor.js',
  optionalFeatureScript: 'build/optional-feature.js',
  optionalFeatureAsset: 'build/optional-feature.svg',
  embedScript: 'build/embed.js',
  offlineRuntimeScript: 'build/offline-runtime.js',
  offlineRuntimeStyles: 'build/offline-runtime.css',
  nestedOfflineRuntimeScript: 'build/nested-offline-runtime.js',
  optionalOfflineFeatureScript: 'build/optional-offline-feature.js',
} as const;

const offlineRuntimeFiles = [
  'assets/diagram-layout-worker-entry-fixture.js',
  'assets/feature-projection-worker-entry-fixture.js',
  'assets/storage-deserializer-worker-fixture.js',
] as const;

export function createBuildManifestFixture(): BuildManifest {
  return {
    [keys.main]: {
      file: files.mainScript,
      isEntry: true,
      name: 'main',
      imports: [keys.shared],
      dynamicImports: [keys.editorApplication],
      css: [files.mainStyles],
    },
    [keys.embed]: {
      file: files.embedScript,
      isEntry: true,
      name: 'embed',
      imports: [keys.shared],
    },
    [keys.shared]: {
      file: files.sharedScript,
      css: [files.sharedStyles],
    },
    [keys.editorApplication]: {
      file: files.editorApplicationScript,
      name: 'editor-application',
      imports: [keys.shared],
      dynamicImports: [keys.optionalFeature],
    },
    [keys.offlineEditor]: {
      file: files.offlineEditorScript,
      isEntry: true,
      name: 'offline-editor',
      imports: [keys.shared],
    },
    [keys.optionalFeature]: {
      file: files.optionalFeatureScript,
      assets: [files.optionalFeatureAsset],
    },
  };
}

export function createOfflineEditorManifestFixture(): BuildManifest {
  return {
    ...createBuildManifestFixture(),
    [keys.offlineEditor]: {
      file: files.offlineEditorScript,
      isEntry: true,
      name: 'offline-editor',
      dynamicImports: [keys.offlineRuntime],
    },
    [keys.offlineRuntime]: {
      file: files.offlineRuntimeScript,
      css: [files.offlineRuntimeStyles],
      imports: [keys.nestedOfflineRuntime],
      dynamicImports: [keys.optionalOfflineFeature],
    },
    [keys.nestedOfflineRuntime]: {
      file: files.nestedOfflineRuntimeScript,
    },
    [keys.optionalOfflineFeature]: {
      file: files.optionalOfflineFeatureScript,
    },
  };
}

export const buildManifestFixture = {
  files,
  keys,
  offlineRuntimeFiles,
} as const;
