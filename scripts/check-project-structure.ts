#!/usr/bin/env tsx
/**
 * The project map follows the workspace's package and module hierarchy, every
 * source module is described beneath its owner, and every locator still
 * exists.
 *
 * AGENTS.md asks that a change adding a subsystem write down how it works and
 * where it lives. That instruction had no teeth: four directories —
 * apps/web/src/share, apps/web/src/sim, apps/web/src/storage and
 * packages/core/src/share — existed with nothing said about any of them, and
 * nothing reported it.
 *
 * Coverage runs in both directions on purpose. A module with no entry is a
 * subsystem whose design can only be recovered by reading every file that
 * touches it. An entry with no module is a map of a place that no longer
 * exists, which is worse than no map.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DOC = resolve(ROOT, 'docs/development/reference/project-structure.md');

interface TurboPackage {
  name: string;
  path: string;
}

interface TurboQueryResponse {
  data: { packages: { items: TurboPackage[] } };
}

/**
 * Workspace roots whose immediate `src/` children are subsystems.
 *
 * Asked of the build graph, not hardcoded. The list used to be three literal
 * paths, and a package added afterwards was invisible to this check for as
 * long as nobody remembered to extend the constant — which is how
 * `packages/pwa-updater` and `packages/tsconfig` both arrived with nothing
 * written about them while the check reported the tree fully described.
 *
 * A check whose coverage is a constant stops covering the repository the
 * moment the repository grows, and says nothing when it does.
 */
function listPackagePaths(): string[] {
  const raw = execFileSync(
    'npx',
    ['turbo', 'query', 'query { packages { items { name path } } }'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  // turbo prints a version banner before the JSON body.
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as TurboQueryResponse;
  // "//" is the workspace root, which is not a package anyone documents.
  return parsed.data.packages.items.filter((p) => p.name !== '//').map((p) => p.path);
}

function sourceRoots(): string[] {
  return listPackagePaths()
    .map((p) => `${p}/src`)
    .filter((p) => existsSync(resolve(ROOT, p)))
    .sort();
}

/**
 * Directories that are deliberately not described as subsystems.
 * `migrations/` is data rather than code, and the Worker section already
 * explains how Wrangler consumes it.
 */
const EXEMPT = new Set(['apps/worker/src/migrations']);

function sourceDirectories(): string[] {
  const found: string[] = [];
  for (const root of sourceRoots()) {
    const abs = resolve(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${root}/${entry.name}`;
      if (!EXEMPT.has(rel)) found.push(rel);
    }
  }
  return found.sort();
}

interface Heading {
  level: number;
  title: string;
  start: number;
  end: number;
  ancestors: string[];
}

const REQUIRED_HEADINGS = [
  ['Workspace'],
  ['Workspace', 'Dependency direction'],
  ['Workspace', 'Tree'],
  ['Packages'],
  ['Packages', 'Core'],
  ['Packages', 'Core', 'Domain model'],
  ['Packages', 'Core', 'Geometry'],
  ['Packages', 'Core', 'Rendering'],
  ['Packages', 'Core', 'Simulation'],
  ['Packages', 'Core', 'Sharing'],
  ['Packages', 'Core', 'Account groundwork'],
  ['Packages', 'PWA updater'],
  ['Packages', 'PWA updater', 'Update lifecycle'],
  ['Packages', 'ESLint plugin'],
  ['Packages', 'ESLint plugin', 'Repository rules'],
  ['Packages', 'TypeScript configuration'],
  ['Applications'],
  ['Applications', 'Web'],
  ['Applications', 'Web', 'Editing'],
  ['Applications', 'Web', 'Map rendering'],
  ['Applications', 'Web', 'UI'],
  ['Applications', 'Web', 'Storage'],
  ['Applications', 'Web', 'Imports and networking'],
  ['Applications', 'Web', 'Simulation host'],
  ['Applications', 'Web', 'Sharing and embedding'],
  ['Applications', 'Web', 'Platform integration'],
  ['Applications', 'Web', 'Performance'],
  ['Applications', 'Worker'],
  ['Applications', 'Worker', 'HTTP delivery'],
  ['Applications', 'Worker', 'Persistence'],
  ['Repository support'],
  ['Repository support', 'Tests'],
  ['Repository support', 'Generators and checks'],
  ['Repository support', 'Performance tooling'],
] as const;

const REQUIRED_GROUPS = ['Workspace', 'Packages', 'Applications', 'Repository support'] as const;

function parseHeadings(source: string): Heading[] {
  const parsed: Heading[] = [];
  const stack: Heading[] = [];

  for (const match of source.matchAll(/^(#{1,6}) +(.+?)\s*$/gm)) {
    const level = match[1]?.length ?? 0;
    const title = match[2]?.trim() ?? '';
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    const heading: Heading = {
      level,
      title,
      start: match.index,
      end: source.length,
      ancestors: stack.map((parent) => parent.title),
    };
    parsed.push(heading);
    stack.push(heading);
  }

  for (const [index, heading] of parsed.entries()) {
    heading.end =
      parsed.slice(index + 1).find((next) => next.level <= heading.level)?.start ?? source.length;
  }
  return parsed;
}

function hierarchyPath(heading: Heading): string[] {
  return [...heading.ancestors, heading.title].filter((title) => title !== 'Project structure');
}

function hierarchyProblems(source: string, headings: Heading[]): string[] {
  const problems: string[] = [];
  const h2 = headings.filter((heading) => heading.level === 2).map((heading) => heading.title);
  if (h2.join('\0') !== REQUIRED_GROUPS.join('\0')) {
    problems.push(`top-level groups must be ${REQUIRED_GROUPS.join(' → ')}`);
  }

  const present = new Set(headings.map((heading) => hierarchyPath(heading).join('\0')));
  for (const path of REQUIRED_HEADINGS) {
    if (!present.has(path.join('\0')))
      problems.push(`missing heading hierarchy: ${path.join(' → ')}`);
  }

  for (const heading of headings.filter((candidate) => candidate.level > 1)) {
    if (
      /\b(?:apps|packages)\//.test(heading.title) ||
      /\b[A-Za-z0-9_.-]+\.(?:css|html|js|json|md|mjs|png|sql|svg|toml|ts|tsx)\b/.test(heading.title)
    ) {
      problems.push(`heading "${heading.title}" names a path or file instead of a module`);
    }
  }

  for (const [index, line] of source.split('\n').entries()) {
    if (/^\s*-\s+`[^`]*\.[A-Za-z0-9]+`\s+(?:—|-)/.test(line)) {
      problems.push(`line ${index + 1} is a filename-led inventory item`);
    }
  }
  return problems;
}

function packageSections(headings: Heading[]): Heading[] {
  return headings.filter(
    (heading) =>
      heading.level === 3 &&
      (heading.ancestors.at(-1) === 'Packages' || heading.ancestors.at(-1) === 'Applications'),
  );
}

function owningSection(
  source: string,
  sections: Heading[],
  packagePath: string,
): Heading | undefined {
  const group = packagePath.startsWith('packages/') ? 'Packages' : 'Applications';
  return sections.find(
    (section) =>
      section.ancestors.at(-1) === group &&
      source.slice(section.start, section.end).includes(packagePath),
  );
}

function documentedSourcePaths(source: string): string[] {
  return [...source.matchAll(/\b((?:apps|packages)\/[A-Za-z0-9_.-]+\/src\/[A-Za-z0-9_.-]+)/g)].map(
    (match) => match[1],
  );
}

function documentedPackagePaths(source: string, sections: Heading[]): string[] {
  return [
    ...new Set(
      sections.flatMap((section) =>
        [
          ...source
            .slice(section.start, section.end)
            .matchAll(/\b((?:apps|packages)\/[A-Za-z0-9_.-]+)/g),
        ].map((match) => match[1]),
      ),
    ),
  ];
}

function main(): void {
  const source = readFileSync(DOC, 'utf8');
  const headings = parseHeadings(source);
  const sections = packageSections(headings);
  const actual = sourceDirectories();
  const docRelative = relative(ROOT, DOC);
  const packagePaths = listPackagePaths();
  const orphanPackages = packagePaths
    .filter((path) => !owningSection(source, sections, path))
    .sort();
  const undocumented = actual
    .filter((path) => {
      const packagePath = path.split('/').slice(0, 2).join('/');
      const section = owningSection(source, sections, packagePath);
      return !section || !source.slice(section.start, section.end).includes(path);
    })
    .sort();

  const missingPackages = documentedPackagePaths(source, sections)
    .filter((path) => !existsSync(resolve(ROOT, path)))
    .sort();
  const missingSources = documentedSourcePaths(source)
    .filter((p) => !p.includes('.'))
    .filter((p) => !existsSync(resolve(ROOT, p)))
    .sort();
  const structure = hierarchyProblems(source, headings);

  if (
    undocumented.length === 0 &&
    missingPackages.length === 0 &&
    missingSources.length === 0 &&
    orphanPackages.length === 0 &&
    structure.length === 0
  ) {
    console.log(`project structure: ${actual.length} source directories, all described.`);
    return;
  }

  console.error(`\n${docRelative} no longer matches the source tree.\n`);

  if (orphanPackages.length > 0) {
    console.error('  Workspace packages not described under their owning group:');
    for (const p of orphanPackages) console.error(`    ${p}`);
    console.error(
      `\n    fix:  describe each as a package or application module in ${docRelative}\n`,
    );
  }

  if (undocumented.length > 0) {
    console.error('  Source modules not described beneath their owning package:');
    for (const d of undocumented) console.error(`    ${d}`);
    console.error(`\n    fix:  describe each beneath its owning package in ${docRelative}\n`);
  }

  if (missingPackages.length > 0 || missingSources.length > 0) {
    console.error('  Described in an owning section, but not present on disk:');
    for (const p of [...missingPackages, ...missingSources]) console.error(`    ${p}`);
    console.error(`\n    fix:  remove or update each entry in ${docRelative}\n`);
  }

  if (structure.length > 0) {
    console.error('  Module hierarchy violations:');
    for (const problem of structure) console.error(`    ${problem}`);
    console.error(
      `\n    fix:  organize packages and modules with the required heading hierarchy\n`,
    );
  }

  process.exit(1);
}

main();
