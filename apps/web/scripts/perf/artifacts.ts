import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { PERF_BASELINE_DIRECTORY } from '../../perf.config';
import type {
  PerfBudgetEvaluation,
  PerfBundleEntry,
  PerfProfileId,
  PerfReport,
} from '../../src/perf/types';
import { APP_ROOT } from './process';

const REPORT_FILENAME = 'report.json';
const BUNDLE_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/bundle-report.json');
const PWA_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/pwa-report.json');

interface BundleReportFile {
  entries: PerfBundleEntry[];
}

export async function readBaseline(path: string | undefined): Promise<PerfReport | undefined> {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PerfReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readBundleEntries(): Promise<PerfBundleEntry[]> {
  const report = JSON.parse(await readFile(BUNDLE_REPORT_PATH, 'utf8')) as BundleReportFile;
  if (!Array.isArray(report.entries)) {
    throw new Error('The generated bundle report has no entries.');
  }
  return report.entries.map((entry) => ({
    entry: entry.entry,
    rawBytes: entry.rawBytes,
    gzipBytes: entry.gzipBytes,
    brotliBytes: entry.brotliBytes,
  }));
}

export function checkedBaselinePath(profile: PerfProfileId): string {
  const filename = profile === 'desktop' ? 'baseline.json' : 'baseline-mobile.json';
  return resolve(APP_ROOT, PERF_BASELINE_DIRECTORY, filename);
}

export async function writeCheckedBaseline(path: string, report: PerfReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function writeReport(outputDirectory: string, report: PerfReport): Promise<string> {
  const path = resolve(outputDirectory, REPORT_FILENAME);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export async function copyBuildReports(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(BUNDLE_REPORT_PATH, resolve(outputDirectory, basename(BUNDLE_REPORT_PATH)));
  await copyFile(PWA_REPORT_PATH, resolve(outputDirectory, basename(PWA_REPORT_PATH)));
}

export function reportEvaluation(evaluation: PerfBudgetEvaluation): void {
  for (const notice of evaluation.notices) console.warn(`performance budget: ${notice}`);
  for (const violation of evaluation.violations) {
    console.error(`performance budget: ${violation.message}`);
  }
}

export function chromeUnavailableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Chromium distribution 'chrome' is not found") ||
    message.includes("Executable doesn't exist") ||
    message.includes('Failed to launch')
  ) {
    return (
      'Google Chrome is required for the fixed headed performance protocol, but it could not ' +
      `be launched. Install stable Chrome and retry. Original error: ${message}`
    );
  }
  return message;
}
