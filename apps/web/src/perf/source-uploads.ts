export interface SourceUploadTiming {
  sourceId: string;
  method: 'setData' | 'updateData';
  callCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export interface SourceUploadCount {
  sourceId: string;
  method: SourceUploadTiming['method'];
  callCount: number;
}

function sourceUploadKey(upload: Pick<SourceUploadTiming, 'sourceId' | 'method'>): string {
  return `${upload.sourceId}\u0000${upload.method}`;
}

export function sourceUploadCountsBetween(
  before: readonly SourceUploadTiming[],
  after: readonly SourceUploadTiming[],
): SourceUploadCount[] {
  const priorCounts = new Map(before.map((upload) => [sourceUploadKey(upload), upload.callCount]));
  return after
    .map((upload) => ({
      sourceId: upload.sourceId,
      method: upload.method,
      callCount: upload.callCount - (priorCounts.get(sourceUploadKey(upload)) ?? 0),
    }))
    .filter((upload) => upload.callCount > 0)
    .sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) || left.method.localeCompare(right.method),
    );
}
