export interface PreviewReceipt {
  version: string;
  url: string;
}
interface Result<Target> {
  target: Target;
  status: 'verified' | 'failed' | 'withheld';
  receipt?: PreviewReceipt;
  phase?: string;
}
export interface PreviewOperations<Target> {
  build(): Promise<void>;
  assertCurrent(): Promise<void>;
  record(entry: { phase: string; target: Target; receipt?: PreviewReceipt }): Promise<void>;
  upload(target: Target): Promise<PreviewReceipt>;
  verify(target: Target, receipt: PreviewReceipt): Promise<void>;
}

async function publishOne<Target>(
  target: Target,
  operations: PreviewOperations<Target>,
): Promise<Result<Target>> {
  let phase = 'guard';
  let receipt: PreviewReceipt | undefined;
  try {
    await operations.assertCurrent();
    phase = 'journal';
    await operations.record({ phase: 'uploading', target });
    phase = 'upload';
    receipt = await operations.upload(target);
    phase = 'journal';
    await operations.record({ phase: 'uploaded', target, receipt });
    phase = 'verify';
    await operations.verify(target, receipt);
    phase = 'guard';
    await operations.assertCurrent();
    phase = 'journal';
    await operations.record({ phase: 'verified', target, receipt });
    return { target, status: 'verified', receipt };
  } catch {
    return { target, status: 'failed', phase, ...(receipt === undefined ? {} : { receipt }) };
  }
}

export async function publishPreviews<Target>(
  targets: Target[],
  operations: PreviewOperations<Target>,
) {
  const results: Result<Target>[] = [];
  if (targets.length === 0) return { ok: true, results };
  try {
    await operations.build();
  } catch {
    return { ok: false, results, phase: 'build' };
  }
  let stopped = false;
  for (const target of targets) {
    if (stopped) {
      results.push({ target, status: 'withheld' });
      continue;
    }
    const result = await publishOne(target, operations);
    results.push(result);
    stopped = result.status === 'failed' && result.phase !== 'verify';
  }
  return { ok: results.every((result) => result.status === 'verified'), results };
}
