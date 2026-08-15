import {
  emittedSource,
  moduleReferences,
  resolvedOutputReference,
  type BundleOutputFiles,
} from './bundle-output';

export interface WorkerOutput {
  files: Set<string>;
  entries: Set<string>;
}

interface WorkerSourceReferences {
  workers: string[];
  modules: string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function supportedDedicatedWorkerConstructors(source: string): RegExpMatchArray[] {
  return [
    ...source.matchAll(
      /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1\s*,\s*import\.meta\.url\s*\)/g,
    ),
  ];
}

function unsupportedDedicatedWorkerReferences(source: string): string[] {
  const supportedIndexes = new Set(
    supportedDedicatedWorkerConstructors(source).map((match) => match.index),
  );
  const urlAliases = new Map(
    [
      ...source.matchAll(
        /\b([A-Za-z_$][\w$]*)\s*=\s*new\s+URL\s*\(\s*(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\2\s*,\s*import\.meta\.url\s*\)/g,
      ),
    ].map((match) => [match[1], match[3]] as const),
  );
  const references: string[] = [];
  for (const match of source.matchAll(
    /new\s+(?:(?:globalThis|self|window)\s*\.\s*)?Worker\s*\(\s*new\s+URL\s*\(\s*(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1/g,
  )) {
    if (!supportedIndexes.has(match.index)) references.push(match[2]);
  }
  for (const match of source.matchAll(
    /new\s+(?:(?:globalThis|self|window)\s*\.\s*)?Worker\s*\(\s*(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1/g,
  )) {
    references.push(match[2]);
  }
  for (const match of source.matchAll(
    /new\s+(?:(?:globalThis|self|window)\s*\.\s*)?Worker\s*\(\s*([A-Za-z_$][\w$]*)/g,
  )) {
    const reference = urlAliases.get(match[1]);
    if (reference) references.push(reference);
  }
  return [...new Set(references)].sort(compareText);
}

function workerSourceReferences(path: string, files: BundleOutputFiles): WorkerSourceReferences {
  const source = emittedSource(path, files);
  const unsupported = unsupportedDedicatedWorkerReferences(source);
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported dedicated Worker constructor for ${unsupported
        .map((reference) => `"${reference}"`)
        .join(', ')} in "${path}". Use new Worker(new URL("./worker.js", import.meta.url)).`,
    );
  }
  return {
    workers: supportedDedicatedWorkerConstructors(source).map((match) => match[2]),
    modules: moduleReferences(source),
  };
}

function resolvedReferences(
  references: readonly string[],
  ownerPath: string,
  files: BundleOutputFiles,
): string[] {
  return references.map((reference) => resolvedOutputReference(reference, ownerPath, files));
}

function enqueueUnvisited(
  references: readonly string[],
  pending: string[],
  visited: Set<string>,
  manifestFiles: Set<string>,
): void {
  for (const reference of references) {
    if (!visited.has(reference) && !manifestFiles.has(reference)) pending.push(reference);
  }
}

export function workerOutput(
  editorFiles: Set<string>,
  manifestFiles: Set<string>,
  files: BundleOutputFiles,
): WorkerOutput {
  const entries = new Set<string>();
  for (const path of [...editorFiles].filter((candidate) => /\.m?js$/.test(candidate))) {
    const references = workerSourceReferences(path, files);
    for (const reference of resolvedReferences(references.workers, path, files)) {
      entries.add(reference);
    }
  }
  const workers = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || workers.has(path) || manifestFiles.has(path)) continue;
    workers.add(path);
    const references = workerSourceReferences(path, files);
    const nestedWorkers = resolvedReferences(references.workers, path, files);
    for (const reference of nestedWorkers) entries.add(reference);
    enqueueUnvisited(nestedWorkers, pending, workers, manifestFiles);
    enqueueUnvisited(
      resolvedReferences(references.modules, path, files),
      pending,
      workers,
      manifestFiles,
    );
  }
  return { files: workers, entries };
}
