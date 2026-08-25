// The dependency directions in docs/development/reference/project-structure.md,
// as rules that fail.
//
// That page has held a diagram of which package may import which since the
// monorepo split, and nothing executed it. The compiler will not: every package
// resolves every other through the workspace, so `apps/web` importing from
// `apps/worker` type-checks perfectly and only shows up as a browser bundle
// that suddenly contains D1 bindings.
//
// ESM rather than TypeScript. dependency-cruiser loads a `.ts` config only when
// `interpret` finds a transpiler registered for it, and none is; adding one for
// a single file costs more than it returns. `check-config.ts` allows `.mjs`
// under the same exemption Prettier uses.
const eagerAppRootModules =
  '^(apps/web/src/(main\\.tsx|app/.*|build-info\\.ts|perf/(field-sampling|field-sampling-policy|startup-marks)\\.ts|theme/font\\.css)|packages/core/src/performance/contract\\.ts)$';

export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means neither module can be understood, tested, or deleted without the other.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'editor-command-groups-are-independent',
      severity: 'error',
      comment:
        'Each editor command group receives the shared store runtime and composes core transforms. ' +
        'Importing another command group creates an implicit command order and a second route to ' +
        'mutation; shared workflows belong in internal operations used by each group.',
      from: { path: '^apps/web/src/editor/store/commands/' },
      to: { path: '^apps/web/src/editor/store/commands/' },
    },
    {
      name: 'app-root-eager-closure-is-shell-only',
      severity: 'error',
      comment:
        'Every static internal edge from the initial application closure stays inside this ' +
        'shell-safe allowlist. This inductive boundary rejects editor, viewer, map, persistence, ' +
        'import, simulation, installation, PWA, UI-host, and renderer implementations even when ' +
        'a shell-safe intermediary imports them. Route hosts enter through a dynamic import.',
      from: { path: eagerAppRootModules },
      to: {
        path: '^(apps/web/src/|packages/)',
        pathNot: eagerAppRootModules,
        dependencyTypesNot: ['dynamic-import', 'type-only'],
      },
    },
    {
      name: 'editor-command-groups-do-not-import-the-public-entry',
      severity: 'error',
      comment:
        'The create-editor-store composition root constructs the command groups, while store.ts ' +
        'only re-exports the public facade. A command importing that facade ' +
        'would invert that dependency and give the module access to a second store instance or ' +
        'public facade instead of its injected runtime.',
      from: { path: '^apps/web/src/editor/store/commands/' },
      to: { path: '^apps/web/src/editor/store\\.ts$' },
    },
    {
      name: 'editor-internal-operations-are-headless',
      severity: 'error',
      comment:
        'Shared editor workflows may compose pure core transforms and editor data contracts only. ' +
        'Importing UI, commands, or the public store facade would turn an internal operation into ' +
        'a hidden orchestration or mutation path.',
      from: { path: '^apps/web/src/editor/store/internal-operations/' },
      to: {
        pathNot:
          '^(packages/core/|apps/web/src/editor/store/(contracts(?:\\.ts|/)|state\\.ts|internal-operations/))',
      },
    },
    {
      name: 'editor-runtime-owns-vanilla-zustand',
      severity: 'error',
      comment:
        'The editor runtime is the single raw Zustand writer. Other modules use its read, ' +
        'subscription, transient-update, and atomic-content ports.',
      from: { pathNot: '^apps/web/src/editor/store/runtime\\.ts$' },
      to: { path: 'node_modules/.*zustand.*/vanilla' },
    },
    {
      name: 'editor-command-dependencies-are-an-allowlist',
      severity: 'error',
      comment:
        'Command groups may know only their contracts, the shared runtime ports, shared internal ' +
        'operations, and pure core transforms. Any other web dependency couples a command to UI ' +
        'or orchestration state and bypasses the composition boundary.',
      from: { path: '^apps/web/src/editor/store/commands/' },
      to: {
        pathNot:
          '^(packages/core/|apps/web/src/editor/store/(contracts(?:\\.ts|/)|runtime\\.ts|internal-operations/))',
      },
    },
    {
      name: 'apps-are-siblings',
      severity: 'error',
      comment:
        'apps/web and apps/worker are two deployments, not two halves of one program. ' +
        'Anything both need belongs in packages/core, which is type-checked for both runtimes. ' +
        'Importing across sends Worker code into the browser bundle and vice versa.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'core-dependencies-are-an-allowlist',
      severity: 'error',
      comment:
        'packages/core runs in the browser and in workerd and is type-checked standalone for ' +
        'either. A dependency it picks up has to work in both, and one that does not fails at ' +
        'runtime in whichever runtime nobody exercised. So core has an allowlist rather than a ' +
        'ban, and adding to it is a deliberate edit here: fflate is pure JavaScript with no ' +
        'platform surface, which is why the GTFS importer may unzip. Anything reaching for a ' +
        'Node built-in, a DOM API, or a Cloudflare binding belongs in an application instead.',
      from: { path: '^packages/core/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
        pathNot: 'node_modules/(\\.pnpm/)?(typescript|@types(\\+|/)|fflate)',
      },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      comment:
        'The dependency direction runs from applications toward shared packages. A package ' +
        'reaching back into an application inverts it and makes the package unusable anywhere else.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'workspace-has-no-application-semantics',
      severity: 'error',
      comment:
        'Workspace composes injected map and chrome slots. Editor commands, application hosts, ' +
        'viewer, persistence, import, simulation, installation, and PWA policy stay in hosts.',
      from: { path: '^packages/workspace/src/' },
      to: {
        path: '^apps/web/src/(App\\.tsx|app/|editor/|viewer/|storage/|import/|sim/|pwa/|ui/(InstallProvider|SimProvider))',
      },
    },
    {
      name: 'src-does-not-import-tests',
      severity: 'error',
      comment: 'Test material must not reach a shipped bundle.',
      from: { path: '^(apps|packages)/[^/]+/src/' },
      to: { path: '^(apps|packages)/[^/]+/tests/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      // Browser-harness artifacts are an alternate Vite output, not source
      // modules. Cruising them creates artificial cycles between Rollup chunks.
      path: '\\.turbo|\\.wrangler|/dist/|/\\.perf-harness-dist/|worker-configuration\\.d\\.ts',
    },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
};
