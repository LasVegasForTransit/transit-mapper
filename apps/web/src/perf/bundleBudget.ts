type BundleEncoding = 'raw' | 'gzip' | 'brotli';

export interface BundleEntrySize {
  entry: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface BundleBudget {
  entry: string;
  maximumGzipBytes: number;
  maximumBrotliBytes: number;
}

export interface BundleBudgetViolation {
  entry: string;
  encoding: BundleEncoding | 'missing';
  actualBytes?: number;
  maximumBytes?: number;
  message: string;
}

interface EncodingBudget {
  encoding: Exclude<BundleEncoding, 'raw'>;
  actualBytes: number;
  maximumBytes: number;
}

function encodingBudgets(size: BundleEntrySize, budget: BundleBudget): EncodingBudget[] {
  return [
    {
      encoding: 'gzip',
      actualBytes: size.gzipBytes,
      maximumBytes: budget.maximumGzipBytes,
    },
    {
      encoding: 'brotli',
      actualBytes: size.brotliBytes,
      maximumBytes: budget.maximumBrotliBytes,
    },
  ];
}

export function evaluateBundleBudgets(
  sizes: BundleEntrySize[],
  budgets: BundleBudget[],
): BundleBudgetViolation[] {
  const violations: BundleBudgetViolation[] = [];

  for (const budget of budgets) {
    const size = sizes.find((candidate) => candidate.entry === budget.entry);
    if (!size) {
      violations.push({
        entry: budget.entry,
        encoding: 'missing',
        message: `${budget.entry} is configured but missing from the Vite manifest.`,
      });
      continue;
    }

    for (const encoding of encodingBudgets(size, budget)) {
      if (encoding.actualBytes <= encoding.maximumBytes) continue;
      violations.push({
        entry: budget.entry,
        encoding: encoding.encoding,
        actualBytes: encoding.actualBytes,
        maximumBytes: encoding.maximumBytes,
        message:
          `${budget.entry} ${encoding.encoding} is ${encoding.actualBytes} bytes; ` +
          `the absolute budget is ${encoding.maximumBytes} bytes.`,
      });
    }
  }

  return violations;
}
