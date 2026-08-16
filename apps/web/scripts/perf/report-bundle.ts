#!/usr/bin/env tsx

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_BUDGETS } from '../../perf.config';
import { evaluateBundleBudgets, type BundleEntrySize } from '../../src/perf/bundleBudget';
import {
  evaluateChunkSizes,
  isMapEngineChunkName,
  performanceChunkKind,
  type PerformanceChunkSize,
} from '../../src/perf/chunkPolicy';
import {
  createDeliveryGraphs,
  type BundleEntryReport,
  type BundleGraphReport,
  type BundleReport,
  type ViteManifest,
} from './bundle-report';
import { compareBundleReports, type BundleReportComparison } from './bundle-report-comparison';
import { validateFrozenBundleReport } from './bundle-report-validation';

export { createDeliveryGraphs, PRODUCTION_WORKER_BOUNDARIES } from './bundle-report';
export { compareBundleReports } from './bundle-report-comparison';
export type {
  BundleEntryReport,
  BundleFileReport,
  BundleGraphReport,
  BundleReport,
  CreateDeliveryGraphsOptions,
  DeliveryGraphs,
  ExpectedWorkerBoundary,
  ViteManifest,
  ViteManifestEntry,
  WorkerBoundaryReport,
  WorkerGraphReport,
} from './bundle-report';
export type {
  BundleByteTotals,
  BundleFileChange,
  BundleGraphComparison,
  BundleMembershipTransition,
  BundleReportComparison,
} from './bundle-report-comparison';

interface SourceMap {
  sources?: unknown;
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIRECTORY = resolve(APP_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST_DIRECTORY, '.vite/manifest.json');
const REPORT_PATH = resolve(DIST_DIRECTORY, 'performance/bundle-report.json');
const COMPARISON_PATH = resolve(DIST_DIRECTORY, 'performance/bundle-report-comparison.json');

export interface BundleReportCommandOptions {
  frozenReportPath?: string;
}

export function parseBundleReportArguments(
  arguments_: readonly string[],
): BundleReportCommandOptions {
  let frozenReportPath: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== '--compare-to') {
      throw new Error(`Unknown bundle report option "${argument}".`);
    }
    if (frozenReportPath !== undefined) {
      throw new Error('The --compare-to option may be provided only once.');
    }
    const path = arguments_[index + 1];
    if (!path || path.startsWith('--')) {
      throw new Error('The --compare-to option requires a frozen BundleReport path.');
    }
    frozenReportPath = path;
    index += 1;
  }
  return frozenReportPath === undefined ? {} : { frozenReportPath };
}

export interface BundleReportArtifactOptions {
  reportPath: string;
  frozenReportPath?: string;
  comparisonPath?: string;
}

function parseFrozenBundleReport(contents: string, path: string): BundleReport {
  return validateFrozenBundleReport(JSON.parse(contents) as unknown, path);
}

interface PreparedArtifact {
  outputPath: string;
  temporaryPath: string;
}

async function prepareJsonArtifact(path: string, value: unknown): Promise<PreparedArtifact> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return { outputPath: path, temporaryPath };
}

async function canonicalPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolutePath);
    if (parent === absolutePath) return absolutePath;
    return resolve(await canonicalPath(parent), basename(absolutePath));
  }
}

async function pathsNameSameFile(left: string, right: string): Promise<boolean> {
  if ((await canonicalPath(left)) === (await canonicalPath(right))) return true;
  try {
    const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeBundleReportArtifacts(
  report: BundleReport,
  options: BundleReportArtifactOptions,
): Promise<BundleReportComparison | undefined> {
  if (
    options.comparisonPath &&
    (await pathsNameSameFile(options.reportPath, options.comparisonPath))
  ) {
    throw new Error('Bundle report and comparison output paths must be distinct.');
  }
  const frozenReportPath = options.frozenReportPath;
  if (
    frozenReportPath &&
    (
      await Promise.all(
        [options.reportPath, options.comparisonPath]
          .filter((path): path is string => path !== undefined)
          .map((path) => pathsNameSameFile(path, frozenReportPath)),
      )
    ).some(Boolean)
  ) {
    throw new Error('Bundle report outputs must not overwrite the frozen report.');
  }
  let comparison: BundleReportComparison | undefined;
  if (frozenReportPath && !options.comparisonPath) {
    throw new Error('An explicit frozen BundleReport path requires a comparison output path.');
  } else if (frozenReportPath && options.comparisonPath) {
    const frozen = parseFrozenBundleReport(
      await readFile(frozenReportPath, 'utf8'),
      frozenReportPath,
    );
    comparison = compareBundleReports(frozen, report);
  }

  const prepared: PreparedArtifact[] = [];
  try {
    prepared.push(await prepareJsonArtifact(options.reportPath, report));
    if (comparison && options.comparisonPath) {
      prepared.push(await prepareJsonArtifact(options.comparisonPath, comparison));
    }
    if (options.comparisonPath) {
      await rm(options.comparisonPath, { force: true });
    }
    for (const artifact of prepared) {
      await rename(artifact.temporaryPath, artifact.outputPath);
    }
  } finally {
    await Promise.all(prepared.map((artifact) => rm(artifact.temporaryPath, { force: true })));
  }
  return comparison;
}

async function outputFiles(): Promise<Record<string, Uint8Array>> {
  const directoryEntries = await readdir(DIST_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });
  const paths = directoryEntries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(DIST_DIRECTORY, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .filter(
      (path) =>
        !path.endsWith('.map') &&
        path !== '.vite/manifest.json' &&
        !path.startsWith('performance/'),
    )
    .sort();
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(resolve(DIST_DIRECTORY, path))] as const),
    ),
  );
}

async function reportChunks(): Promise<PerformanceChunkSize[]> {
  const directoryEntries = await readdir(DIST_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });
  const files = directoryEntries
    .filter((entry) => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map((entry) =>
      relative(DIST_DIRECTORY, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .sort();
  return Promise.all(
    files.map(async (file) => {
      let moduleIds: string[] = [];
      if (isMapEngineChunkName(file)) {
        try {
          const sourceMap = JSON.parse(
            await readFile(resolve(DIST_DIRECTORY, `${file}.map`), 'utf8'),
          ) as SourceMap;
          moduleIds = Array.isArray(sourceMap.sources)
            ? sourceMap.sources.filter((source): source is string => typeof source === 'string')
            : [];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return {
        file,
        rawBytes: (await stat(resolve(DIST_DIRECTORY, file))).size,
        kind: performanceChunkKind(file, moduleIds),
      };
    }),
  );
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1_024).toFixed(1)} KiB`;
}

function logGraph(label: string, graph: BundleGraphReport): void {
  console.log(
    `${label}: raw ${formatKiB(graph.rawBytes)}, ` +
      `gzip ${formatKiB(graph.gzipBytes)}, brotli ${formatKiB(graph.brotliBytes)}`,
  );
}

/**
 * A first load pays the entry's static closure. A dynamic import has its own
 * delivery and chunk contracts, but does not belong in startup byte limits.
 */
export function initialDeliverySizes(entries: readonly BundleEntryReport[]): BundleEntrySize[] {
  return entries.map(({ entry, eager }) => ({
    entry,
    rawBytes: eager.rawBytes,
    gzipBytes: eager.gzipBytes,
    brotliBytes: eager.brotliBytes,
  }));
}

async function main(arguments_: readonly string[]): Promise<void> {
  const command = parseBundleReportArguments(arguments_);
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as ViteManifest;
  const graphs = createDeliveryGraphs({ manifest, files: await outputFiles() });
  const chunks = await reportChunks();
  const violations = evaluateBundleBudgets(initialDeliverySizes(graphs.entries), BUNDLE_BUDGETS);
  const chunkViolations = evaluateChunkSizes(chunks);
  const report: BundleReport = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    ...graphs,
    chunks,
    violations,
    chunkViolations,
  };
  const comparison = await writeBundleReportArtifacts(report, {
    reportPath: REPORT_PATH,
    comparisonPath: COMPARISON_PATH,
    ...(command.frozenReportPath
      ? {
          frozenReportPath: command.frozenReportPath,
        }
      : {}),
  });
  for (const entry of report.entries) {
    logGraph(`bundle ${entry.entry} eager`, entry.eager);
    logGraph(`bundle ${entry.entry} lazy`, entry.lazy);
    logGraph(`bundle ${entry.entry} complete`, entry.complete);
  }
  logGraph('dedicated Workers', report.workers);
  logGraph('service Worker', report.serviceWorker);
  logGraph('install assets', report.installAssets);
  logGraph('precache union', report.precache);
  const largestChunk = [...chunks].sort((left, right) => right.rawBytes - left.rawBytes).at(0);
  if (largestChunk) {
    console.log(
      `largest JavaScript chunk: ${largestChunk.file} (${formatKiB(largestChunk.rawBytes)})`,
    );
  }
  console.log(`bundle report: ${REPORT_PATH}`);
  if (comparison) {
    console.log(
      `bundle N-1 update bytes: raw ${comparison.updateBytes.rawBytes}, ` +
        `gzip ${comparison.updateBytes.gzipBytes}, ` +
        `brotli ${comparison.updateBytes.brotliBytes}; membership transitions ` +
        `${comparison.membershipTransitions.length}`,
    );
    console.log(`bundle N-1 comparison: ${COMPARISON_PATH}`);
  }
  for (const violation of violations) console.error(`bundle budget: ${violation.message}`);
  for (const violation of chunkViolations) console.error(`chunk budget: ${violation.message}`);
  if (violations.length > 0 || chunkViolations.length > 0) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`bundle report unavailable: ${message}`);
    process.exitCode = 1;
  });
}
