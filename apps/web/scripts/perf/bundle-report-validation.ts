import type {
  BundleFileReport,
  BundleGraphReport,
  BundleReport,
  WorkerGraphReport,
} from './bundle-report';

type UnknownRecord = Record<string, unknown>;

function invalid(reportPath: string, detail: string): never {
  throw new Error(`Frozen BundleReport "${reportPath}" is invalid: ${detail}.`);
}

function record(value: unknown, reportPath: string, context: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(reportPath, `${context} must be an object`);
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, reportPath: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(reportPath, `${context} must be a non-empty string`);
  }
  return value;
}

function byteCount(value: unknown, reportPath: string, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(reportPath, `${context} must be a non-negative safe integer`);
  }
  return value;
}

function bundleFile(value: unknown, reportPath: string, context: string): BundleFileReport {
  const file = record(value, reportPath, context);
  const path = stringValue(file.path, reportPath, `${context}.path`);
  const digest = stringValue(file.digest, reportPath, `${context}.digest`);
  if (!/^sha256:[a-f\d]{64}$/.test(digest)) {
    invalid(reportPath, `${context}.digest must be a SHA-256 digest`);
  }
  return {
    path,
    digest,
    rawBytes: byteCount(file.rawBytes, reportPath, `${context}.rawBytes`),
    gzipBytes: byteCount(file.gzipBytes, reportPath, `${context}.gzipBytes`),
    brotliBytes: byteCount(file.brotliBytes, reportPath, `${context}.brotliBytes`),
  };
}

interface GraphTotalOptions {
  graph: UnknownRecord;
  files: readonly BundleFileReport[];
  metric: 'rawBytes' | 'gzipBytes' | 'brotliBytes';
  reportPath: string;
  context: string;
}

function graphTotal(options: GraphTotalOptions): number {
  const { graph, files, metric, reportPath, context } = options;
  const reported = byteCount(graph[metric], reportPath, `${context}.${metric}`);
  const calculated = files.reduce((total, file) => total + file[metric], 0);
  if (reported !== calculated) {
    invalid(reportPath, `${context}.${metric} does not equal its file total`);
  }
  return reported;
}

function bundleGraph(value: unknown, reportPath: string, context: string): BundleGraphReport {
  const graph = record(value, reportPath, context);
  if (!Array.isArray(graph.files)) invalid(reportPath, `${context}.files must be an array`);
  const files = graph.files.map((file, index) =>
    bundleFile(file, reportPath, `${context}.files[${index}]`),
  );
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) {
    invalid(reportPath, `${context}.files must not repeat a path`);
  }
  if (paths.some((path, index) => index > 0 && path < paths[index - 1])) {
    invalid(reportPath, `${context}.files must be sorted by path`);
  }
  return {
    files,
    rawBytes: graphTotal({ graph, files, metric: 'rawBytes', reportPath, context }),
    gzipBytes: graphTotal({ graph, files, metric: 'gzipBytes', reportPath, context }),
    brotliBytes: graphTotal({ graph, files, metric: 'brotliBytes', reportPath, context }),
  };
}

function workerGraph(value: unknown, reportPath: string): WorkerGraphReport {
  const graph = record(value, reportPath, 'workers');
  const sizedGraph = bundleGraph(graph, reportPath, 'workers');
  if (!Array.isArray(graph.boundaries)) {
    invalid(reportPath, 'workers.boundaries must be an array');
  }
  const identities = new Set<string>();
  const paths = new Set(sizedGraph.files.map((file) => file.path));
  const boundaries = graph.boundaries.map((value, index) => {
    const boundary = record(value, reportPath, `workers.boundaries[${index}]`);
    const identity = stringValue(
      boundary.identity,
      reportPath,
      `workers.boundaries[${index}].identity`,
    );
    const path = stringValue(boundary.path, reportPath, `workers.boundaries[${index}].path`);
    if (identities.has(identity)) invalid(reportPath, `workers repeats identity "${identity}"`);
    if (!paths.has(path)) invalid(reportPath, `Worker boundary "${identity}" is outside its graph`);
    identities.add(identity);
    return { identity, path };
  });
  return { ...sizedGraph, boundaries };
}

function sameFile(left: BundleFileReport, right: BundleFileReport): boolean {
  return (
    left.path === right.path &&
    left.digest === right.digest &&
    left.rawBytes === right.rawBytes &&
    left.gzipBytes === right.gzipBytes &&
    left.brotliBytes === right.brotliBytes
  );
}

interface EntryGraphAlgebraOptions {
  eager: BundleGraphReport;
  lazy: BundleGraphReport;
  complete: BundleGraphReport;
  reportPath: string;
  entry: string;
}

function validateEntryGraphAlgebra(options: EntryGraphAlgebraOptions): void {
  const { eager, lazy, complete, reportPath, entry } = options;
  const eagerFiles = new Map(eager.files.map((file) => [file.path, file]));
  const lazyFiles = new Map(lazy.files.map((file) => [file.path, file]));
  if (lazy.files.some((file) => eagerFiles.has(file.path))) {
    invalid(reportPath, `entries.${entry} eager and lazy graphs must be disjoint`);
  }
  const union = new Map([...eagerFiles, ...lazyFiles]);
  const completeFiles = new Map(complete.files.map((file) => [file.path, file]));
  if (
    union.size !== completeFiles.size ||
    [...union].some(([path, file]) => {
      const completeFile = completeFiles.get(path);
      return !completeFile || !sameFile(file, completeFile);
    })
  ) {
    invalid(reportPath, `entries.${entry} complete graph must equal its eager and lazy union`);
  }
}

function entries(value: unknown, reportPath: string): BundleReport['entries'] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(reportPath, 'entries must be a non-empty array');
  }
  const names = new Set<string>();
  return value.map((value, index) => {
    const candidate = record(value, reportPath, `entries[${index}]`);
    const entry = stringValue(candidate.entry, reportPath, `entries[${index}].entry`);
    if (names.has(entry)) invalid(reportPath, `entries repeats "${entry}"`);
    names.add(entry);
    const eager = bundleGraph(candidate.eager, reportPath, `entries.${entry}.eager`);
    const lazy = bundleGraph(candidate.lazy, reportPath, `entries.${entry}.lazy`);
    const complete = bundleGraph(candidate.complete, reportPath, `entries.${entry}.complete`);
    validateEntryGraphAlgebra({ eager, lazy, complete, reportPath, entry });
    for (const metric of ['rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
      if (
        byteCount(candidate[metric], reportPath, `entries.${entry}.${metric}`) !== complete[metric]
      ) {
        invalid(reportPath, `entries.${entry}.${metric} does not equal its complete graph`);
      }
    }
    return {
      entry,
      rawBytes: complete.rawBytes,
      gzipBytes: complete.gzipBytes,
      brotliBytes: complete.brotliBytes,
      eager,
      lazy,
      complete,
    };
  });
}

function array(value: unknown, reportPath: string, context: string): unknown[] {
  if (!Array.isArray(value)) invalid(reportPath, `${context} must be an array`);
  return value;
}

export function validateFrozenBundleReport(value: unknown, reportPath: string): BundleReport {
  const report = record(value, reportPath, 'report');
  if (report.schemaVersion !== 3) {
    throw new Error(`Frozen BundleReport "${reportPath}" must use schema version 3.`);
  }
  const validatedEntries = entries(report.entries, reportPath);
  return {
    schemaVersion: 3,
    generatedAt: stringValue(report.generatedAt, reportPath, 'generatedAt'),
    entries: validatedEntries,
    workers: workerGraph(report.workers, reportPath),
    serviceWorker: bundleGraph(report.serviceWorker, reportPath, 'serviceWorker'),
    installAssets: bundleGraph(report.installAssets, reportPath, 'installAssets'),
    precache: bundleGraph(report.precache, reportPath, 'precache'),
    chunks: array(report.chunks, reportPath, 'chunks') as BundleReport['chunks'],
    violations: array(report.violations, reportPath, 'violations') as BundleReport['violations'],
    chunkViolations: array(
      report.chunkViolations,
      reportPath,
      'chunkViolations',
    ) as BundleReport['chunkViolations'],
  };
}
