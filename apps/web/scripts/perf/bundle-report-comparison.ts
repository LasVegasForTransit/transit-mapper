import type { BundleFileReport, BundleGraphReport, BundleReport } from './bundle-report';

export interface BundleFileChange {
  path: string;
  before: BundleFileReport;
  after: BundleFileReport;
}

export interface BundleByteTotals {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

interface BundleFileDelta {
  added: BundleFileReport[];
  removed: BundleFileReport[];
  changed: BundleFileChange[];
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface BundleGraphComparison extends BundleFileDelta {
  graph: string;
}

export interface BundleMembershipTransition {
  path: string;
  addedTo: string[];
  removedFrom: string[];
}

export interface BundleReportComparison extends BundleFileDelta {
  updateBytes: BundleByteTotals;
  graphs: BundleGraphComparison[];
  membershipTransitions: BundleMembershipTransition[];
}

const EMPTY_GRAPH: BundleGraphReport = {
  files: [],
  rawBytes: 0,
  gzipBytes: 0,
  brotliBytes: 0,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameFile(left: BundleFileReport, right: BundleFileReport): boolean {
  return (
    left.rawBytes === right.rawBytes &&
    left.gzipBytes === right.gzipBytes &&
    left.brotliBytes === right.brotliBytes &&
    left.digest === right.digest
  );
}

function fileMap(files: Iterable<BundleFileReport>): Map<string, BundleFileReport> {
  const byPath = new Map<string, BundleFileReport>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (existing && !sameFile(existing, file)) {
      throw new Error(`Bundle report contains conflicting metadata for "${file.path}".`);
    }
    byPath.set(file.path, file);
  }
  return byPath;
}

function compareFiles(
  before: Map<string, BundleFileReport>,
  after: Map<string, BundleFileReport>,
  beforeGraph: BundleGraphReport,
  afterGraph: BundleGraphReport,
): BundleFileDelta {
  const added = [...after.values()]
    .filter((file) => !before.has(file.path))
    .sort((left, right) => compareText(left.path, right.path));
  const removed = [...before.values()]
    .filter((file) => !after.has(file.path))
    .sort((left, right) => compareText(left.path, right.path));
  const changed = [...after.values()]
    .flatMap((file) => {
      const previous = before.get(file.path);
      return previous && previous.digest !== file.digest
        ? [{ path: file.path, before: previous, after: file }]
        : [];
    })
    .sort((left, right) => compareText(left.path, right.path));
  return {
    added,
    removed,
    changed,
    rawBytes: afterGraph.rawBytes - beforeGraph.rawBytes,
    gzipBytes: afterGraph.gzipBytes - beforeGraph.gzipBytes,
    brotliBytes: afterGraph.brotliBytes - beforeGraph.brotliBytes,
  };
}

function namedGraphs(report: BundleReport): Map<string, BundleGraphReport> {
  const graphs = new Map<string, BundleGraphReport>();
  for (const entry of report.entries) {
    for (const [kind, graph] of [
      ['eager', entry.eager],
      ['lazy', entry.lazy],
      ['complete', entry.complete],
    ] as const) {
      const name = `entries.${entry.entry}.${kind}`;
      if (graphs.has(name)) throw new Error(`Bundle report repeats graph "${name}".`);
      graphs.set(name, graph);
    }
  }
  graphs.set('workers', report.workers);
  graphs.set('serviceWorker', report.serviceWorker);
  graphs.set('installAssets', report.installAssets);
  graphs.set('precache', report.precache);
  return graphs;
}

function reportFiles(graphs: Map<string, BundleGraphReport>): Map<string, BundleFileReport> {
  return fileMap([...graphs.values()].flatMap((graph) => graph.files));
}

function graphComparisons(
  before: Map<string, BundleGraphReport>,
  after: Map<string, BundleGraphReport>,
): BundleGraphComparison[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  return names.map((graph) => {
    const beforeGraph = before.get(graph) ?? EMPTY_GRAPH;
    const afterGraph = after.get(graph) ?? EMPTY_GRAPH;
    return {
      graph,
      ...compareFiles(
        fileMap(beforeGraph.files),
        fileMap(afterGraph.files),
        beforeGraph,
        afterGraph,
      ),
    };
  });
}

function memberships(graphs: Map<string, BundleGraphReport>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [name, graph] of graphs) {
    for (const file of graph.files) {
      const graphNames = result.get(file.path) ?? new Set<string>();
      graphNames.add(name);
      result.set(file.path, graphNames);
    }
  }
  return result;
}

function membershipTransitions(
  beforeGraphs: Map<string, BundleGraphReport>,
  afterGraphs: Map<string, BundleGraphReport>,
): BundleMembershipTransition[] {
  const before = memberships(beforeGraphs);
  const after = memberships(afterGraphs);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  return paths.flatMap((path) => {
    const previous = before.get(path) ?? new Set<string>();
    const next = after.get(path) ?? new Set<string>();
    const addedTo = [...next].filter((graph) => !previous.has(graph)).sort(compareText);
    const removedFrom = [...previous].filter((graph) => !next.has(graph)).sort(compareText);
    return addedTo.length > 0 || removedFrom.length > 0 ? [{ path, addedTo, removedFrom }] : [];
  });
}

function uniqueGraph(files: Map<string, BundleFileReport>): BundleGraphReport {
  const values = [...files.values()];
  return {
    files: values,
    rawBytes: values.reduce((total, file) => total + file.rawBytes, 0),
    gzipBytes: values.reduce((total, file) => total + file.gzipBytes, 0),
    brotliBytes: values.reduce((total, file) => total + file.brotliBytes, 0),
  };
}

function updateBytes(delta: BundleFileDelta): BundleByteTotals {
  const files = [...delta.added, ...delta.changed.map((change) => change.after)];
  return {
    rawBytes: files.reduce((total, file) => total + file.rawBytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    brotliBytes: files.reduce((total, file) => total + file.brotliBytes, 0),
  };
}

export function compareBundleReports(
  before: BundleReport,
  after: BundleReport,
): BundleReportComparison {
  const beforeGraphs = namedGraphs(before);
  const afterGraphs = namedGraphs(after);
  const beforeFiles = reportFiles(beforeGraphs);
  const afterFiles = reportFiles(afterGraphs);
  const delta = compareFiles(
    beforeFiles,
    afterFiles,
    uniqueGraph(beforeFiles),
    uniqueGraph(afterFiles),
  );
  return {
    ...delta,
    updateBytes: updateBytes(delta),
    graphs: graphComparisons(beforeGraphs, afterGraphs),
    membershipTransitions: membershipTransitions(beforeGraphs, afterGraphs),
  };
}
