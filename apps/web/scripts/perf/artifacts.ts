import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { PERF_BASELINE_DIRECTORY } from '../../perf.config';
import type {
  PerfBudgetEvaluation,
  PerfBundleEntry,
  PerfProfileId,
  PerfReport,
} from '../../src/perf/types';
import { APP_ROOT } from './process';
import { validateFrozenPerfReport } from './perf-report-validation';

const REPORT_FILENAME = 'report.json';
const BUNDLE_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/bundle-report.json');
const PWA_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/pwa-report.json');
const BASELINE_CHECKSUM_SUFFIX = '.sha256';

interface BundleReportFile {
  entries: PerfBundleEntry[];
}

export async function readBaseline(path: string | undefined): Promise<PerfReport | undefined> {
  if (!path) return undefined;
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const expectedChecksum = (await readFile(`${path}${BASELINE_CHECKSUM_SUFFIX}`, 'utf8')).trim();
  const actualChecksum = createHash('sha256').update(contents).digest('hex');
  if (expectedChecksum !== actualChecksum) {
    throw new Error(`Frozen PerfReport "${path}" integrity checksum does not match.`);
  }
  return validateFrozenPerfReport(JSON.parse(contents), path);
}

export async function readBundleEntries(
  path: string = BUNDLE_REPORT_PATH,
): Promise<PerfBundleEntry[]> {
  const report = JSON.parse(await readFile(path, 'utf8')) as BundleReportFile;
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

export async function freezeCheckedBaseline(path: string, report: PerfReport): Promise<void> {
  validateFrozenPerfReport(report, path);
  await mkdir(dirname(path), { recursive: true });
  const contents = `${JSON.stringify(report, null, 2)}\n`;
  const checksum = `${createHash('sha256').update(contents).digest('hex')}\n`;
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryChecksumPath = `${temporaryPath}${BASELINE_CHECKSUM_SUFFIX}`;
  const temporary = await open(temporaryPath, 'wx');
  const temporaryChecksum = await open(temporaryChecksumPath, 'wx');
  try {
    await temporary.writeFile(contents, 'utf8');
    await temporary.sync();
    await temporaryChecksum.writeFile(checksum, 'utf8');
    await temporaryChecksum.sync();
  } finally {
    await temporary.close();
    await temporaryChecksum.close();
  }
  try {
    // A hard link publishes the fully written inode without replacing an
    // existing baseline. The checked comparison point is intentionally
    // immutable; changing it requires deleting it as an explicit review step.
    await link(temporaryPath, path);
    try {
      await link(temporaryChecksumPath, `${path}${BASELINE_CHECKSUM_SUFFIX}`);
    } catch (error) {
      await unlink(path);
      throw error;
    }
  } finally {
    await Promise.all([unlink(temporaryPath), unlink(temporaryChecksumPath)]);
  }
}

export async function writeReport(outputDirectory: string, report: PerfReport): Promise<string> {
  const path = resolve(outputDirectory, REPORT_FILENAME);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export async function copyBuildReports(
  outputDirectory: string,
  sourceDirectory: string = dirname(BUNDLE_REPORT_PATH),
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(
    resolve(sourceDirectory, basename(BUNDLE_REPORT_PATH)),
    resolve(outputDirectory, basename(BUNDLE_REPORT_PATH)),
  );
  await copyFile(
    resolve(sourceDirectory, basename(PWA_REPORT_PATH)),
    resolve(outputDirectory, basename(PWA_REPORT_PATH)),
  );
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
