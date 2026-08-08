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
      name: 'src-does-not-import-tests',
      severity: 'error',
      comment: 'Test material must not reach a shipped bundle.',
      from: { path: '^(apps|packages)/[^/]+/src/' },
      to: { path: '^(apps|packages)/[^/]+/tests/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.turbo|\\.wrangler|/dist/|worker-configuration\\.d\\.ts' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
};
