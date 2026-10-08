import type { Finding } from './status.ts';
import path from 'node:path';
import { standardCommandsFor } from '../packages/cli/src/lib/check/standard.mjs';
import { OWNED_FILES } from './owned-files.ts';
import {
  turboCacheProblem,
  turboCacheRequired,
} from '../packages/cli/src/lib/check/turbo-cache.mjs';

export interface ProcessSnapshot {
  name: string;
  kind: 'source' | 'template' | 'consumer';
  files: Record<string, string | null>;
  paths: string[];
}

interface Package {
  scripts?: Record<string, string>;
}
interface Tooling {
  version?: number;
  audits?: { workflow?: string };
  release?: {
    stagingWorkflow?: { path?: string };
    promotionWorkflow?: { file?: string };
  };
}
const families = ['eslint', 'prettier', 'typescript', 'vitest', 'playwright'];
export function configurationFamily(file: string): string | undefined {
  const name = path.posix.basename(file);
  if (/^tsconfig(?:\.[\w-]+)?\.json$/u.test(name)) return 'typescript';
  return families.find((family) => new RegExp(`^${family}\\.config\\.[cm]?[jt]s$`, 'u').test(name));
}
export function inventoryPaths(paths: string[]): string[] {
  const root = [
    'package.json',
    'pnpm-workspace.yaml',
    'turbo.json',
    '.lvbt/web-platform.json',
    '.lvbt/tooling.json',
    '.claude/settings.json',
  ];
  return [
    ...new Set([
      ...root,
      ...OWNED_FILES,
      ...paths.filter(
        (file) =>
          !file.startsWith('.lvbt/web-platform/') &&
          (file.endsWith('/package.json') ||
            configurationFamily(file) !== undefined ||
            /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file)),
      ),
    ]),
  ];
}
function json(input: string | null | undefined): unknown {
  try {
    return input ? (JSON.parse(input) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
/** Resolve only declared local modules; an unproven external wrapper remains a diagnostic. */
export function configurationTargets(files: ProcessSnapshot['files'], file: string): string[] {
  const targets: string[] = [];
  const content = files[file] ?? '';
  for (const match of content.matchAll(/['"]([^'"]+)['"]/gu)) {
    const specifier = match[1] ?? '';
    if (specifier.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      targets.push(base, `${base}.json`, `${base}.js`, `${base}.mjs`, `${base}.ts`);
      if (base.endsWith('.js')) targets.push(base.slice(0, -3) + '.ts');
      continue;
    }
    for (const [manifest, source] of Object.entries(files)) {
      if (!manifest.endsWith('/package.json')) continue;
      const pkg = json(source) as { name?: string; exports?: Record<string, unknown> } | undefined;
      if (!pkg?.name || !specifier.startsWith(`${pkg.name}/`)) continue;
      const entry = pkg.exports?.[`./${specifier.slice(pkg.name.length + 1)}`];
      const visit = (value: unknown): void => {
        if (typeof value === 'string' && value.startsWith('./'))
          targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(manifest), value)));
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(entry);
    }
  }
  return [...new Set(targets)];
}
function sharedConfiguration(
  files: ProcessSnapshot['files'],
  file: string,
  family: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const content = files[file];
  if (!content) return false;
  if (content.includes(`@lasvegasfortransit/${family}-config`)) return true;
  return configurationTargets(files, file).some((target) =>
    sharedConfiguration(files, target, family, seen),
  );
}
function commandFindings(
  snapshot: ProcessSnapshot,
  pkg: Package,
  add: (rule: string, message: string) => void,
): void {
  const vendored =
    snapshot.paths.includes('.lvbt/web-platform/packages/cli/src/cli.mjs') ||
    snapshot.files['.lvbt/web-platform/packages/cli/src/cli.mjs'] !== undefined;
  for (const [name, command] of Object.entries(standardCommandsFor({ vendored })))
    if (pkg.scripts?.[name] !== command)
      add(
        `command:${name}`,
        `Root ${name} must use ${command}; move product checks into Turbo validate (required from v0.8.0).`,
      );
  if (
    !/^(?:verifyDepsBeforeRun|'verifyDepsBeforeRun'|"verifyDepsBeforeRun")\s*:\s*false(?:\s*#.*)?\s*$/mu.test(
      snapshot.files['pnpm-workspace.yaml'] ?? '',
    )
  )
    add(
      'preflight-install',
      'Set verifyDepsBeforeRun: false in pnpm-workspace.yaml so preflight cannot auto-install.',
    );
}
function fileFindings(
  snapshot: ProcessSnapshot,
  add: (rule: string, message: string) => void,
): void {
  for (const file of OWNED_FILES) {
    const expected = snapshot.files[`.lvbt/web-platform/examples/with-astro/${file}`];
    if (typeof expected === 'string' && snapshot.files[file] !== expected)
      add('owned-file', `${file} differs from the adopted shared copy.`);
    else if (file.startsWith('.githooks/') && !snapshot.files[file])
      add('hooks', `${file} is missing; adopt the shared hook.`);
  }
  for (const file of Object.keys(snapshot.files)) {
    const family = configurationFamily(file);
    if (family && !file.startsWith('.lvbt/') && !sharedConfiguration(snapshot.files, file, family))
      add(
        'shared-config',
        `${file}: @lasvegasfortransit/${family}-config is not established by inventoried direct or relative imports; review workspace wrappers before changing product rules.`,
      );
  }
}
function auditFindings(
  tooling: Tooling | undefined,
  files: ProcessSnapshot['files'],
  add: (rule: string, message: string) => void,
): void {
  if (tooling?.version !== 1)
    add(
      'tooling',
      'Declare version 1 local setup, audit targets, and releases in .lvbt/tooling.json.',
    );
  const audit = files[tooling?.audits?.workflow ?? '.github/workflows/audits.yml'] ?? '';
  if (
    !tooling?.audits ||
    !audit.includes('schedule:') ||
    !audit.includes('workflow_dispatch:') ||
    !(
      /audit\s+(?:report|--target\s+production)/u.test(audit) ||
      /^[\t ]*uses:[\t ]*([\x22\x27]?)LasVegasForTransit\/repository-tooling\/\.github\/workflows\/audit\.ya?ml@[a-f0-9]{40}\1[\t ]*(?:#.*)?$/mu.test(
        audit,
      )
    )
  )
    add(
      'audit-workflow',
      'Declare shared audits and a trusted default-branch schedule/manual workflow with issue reconciliation.',
    );
}
function releaseFindings(
  tooling: Tooling | undefined,
  files: ProcessSnapshot['files'],
  add: (rule: string, message: string) => void,
): void {
  const release = tooling?.release;
  if (!release) return;
  for (const [rule, file] of [
    ['staging-workflow', release.stagingWorkflow?.path],
    [
      'promotion-workflow',
      release.promotionWorkflow?.file
        ? `.github/workflows/${release.promotionWorkflow.file}`
        : undefined,
    ],
  ] as const) {
    const source = file ? (files[file] ?? '') : '';
    if (
      !/LasVegasForTransit\/repository-tooling\/\.github\/workflows\/release-(?:build|publish|source)\.ya?ml@[a-f0-9]{40}/u.test(
        source,
      )
    )
      add(rule, `${file ?? rule} must call the pinned shared saved-release workflow.`);
  }
}
function cacheFindings(snapshot: ProcessSnapshot): Finding[] {
  const provenance = json(snapshot.files['.lvbt/web-platform.json']) as
    { release?: string } | undefined;
  const problem = turboCacheProblem(snapshot.files['turbo.json']);
  return problem
    ? [
        {
          repository: snapshot.name,
          rule: 'turbo-cache',
          message: `${problem} (required from v0.8.0).`,
          severity: turboCacheRequired(provenance?.release) ? 'error' : 'warning',
        },
      ]
    : [];
}
export function processFindings(snapshot: ProcessSnapshot): Finding[] {
  if (snapshot.kind === 'source' || !snapshot.files['package.json']) return [];
  const found: Finding[] = [];
  const add = (rule: string, message: string) =>
    found.push({ repository: snapshot.name, rule, message, severity: 'warning' as const });
  const pkg = json(snapshot.files['package.json']) as Package | undefined;
  if (!pkg) {
    add('package', 'Root package.json is unreadable.');
    return found;
  }
  commandFindings(snapshot, pkg, add);
  fileFindings(snapshot, add);
  const provenance = json(snapshot.files['.lvbt/web-platform.json']) as
    { commit?: string; contentHash?: string } | undefined;
  found.push(...cacheFindings(snapshot));
  if (
    !/^[a-f0-9]{40}$/u.test(provenance?.commit ?? '') ||
    !/^[a-f0-9]{64}$/u.test(provenance?.contentHash ?? '')
  )
    add(
      'provenance',
      'Record the generated standard commit and content hash in .lvbt/web-platform.json.',
    );
  const tooling = json(snapshot.files['.lvbt/tooling.json']) as Tooling | undefined;
  auditFindings(tooling, snapshot.files, add);
  if (pkg.scripts?.deploy && !tooling?.release)
    add(
      'release-config',
      'Root deploy is declared; configure shared staging and explicit promotion in .lvbt/tooling.json.',
    );
  releaseFindings(tooling, snapshot.files, add);
  return found;
}
