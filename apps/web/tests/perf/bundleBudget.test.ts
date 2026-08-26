import { describe, expect, it } from 'vitest';
import { evaluateBundleBudgets } from '../../src/perf/bundleBudget';
import type { BundleBudget, BundleEntrySize } from '../../src/perf/bundleBudget';
import { BUNDLE_BUDGETS } from '../../perf.config';

const budgets: BundleBudget[] = [
  {
    entry: 'main',
    maximumGzipBytes: 500,
    maximumBrotliBytes: 400,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 400,
    maximumBrotliBytes: 300,
  },
];

describe('bundle budgets', () => {
  it('keeps the editor inside its established delivery ceiling', () => {
    const main = BUNDLE_BUDGETS.find((budget) => budget.entry === 'main');
    expect(main).toEqual({
      entry: 'main',
      maximumGzipBytes: 532_480,
      maximumBrotliBytes: 450_560,
    });
    expect(
      evaluateBundleBudgets(
        [
          {
            entry: 'main',
            rawBytes: 1_000_000,
            gzipBytes: 532_481,
            brotliBytes: 450_560,
          },
        ],
        main ? [main] : [],
      ),
    ).toContainEqual(expect.objectContaining({ entry: 'main', encoding: 'gzip' }));
  });

  it('gives the full viewer its own strict first-load ceiling', () => {
    expect(BUNDLE_BUDGETS.find((budget) => budget.entry === 'viewer')).toEqual({
      entry: 'viewer',
      maximumGzipBytes: 307_200,
      maximumBrotliBytes: 256_000,
    });
  });

  it('gates delivered bytes without treating raw module size as a product ceiling', () => {
    const sizes: BundleEntrySize[] = [
      { entry: 'main', rawBytes: 99_999, gzipBytes: 499, brotliBytes: 399 },
      { entry: 'embed', rawBytes: 99_999, gzipBytes: 399, brotliBytes: 299 },
    ];

    expect(evaluateBundleBudgets(sizes, budgets)).toEqual([]);
  });

  it('reports the entry and encoding that exceed an absolute limit', () => {
    const sizes: BundleEntrySize[] = [
      { entry: 'main', rawBytes: 999, gzipBytes: 499, brotliBytes: 401 },
      { entry: 'embed', rawBytes: 799, gzipBytes: 399, brotliBytes: 299 },
    ];

    expect(evaluateBundleBudgets(sizes, budgets)).toContainEqual({
      entry: 'main',
      encoding: 'brotli',
      actualBytes: 401,
      maximumBytes: 400,
      message: 'main brotli is 401 bytes; the absolute budget is 400 bytes.',
    });
  });

  it('reports a missing configured entry instead of silently skipping it', () => {
    const sizes: BundleEntrySize[] = [
      { entry: 'main', rawBytes: 999, gzipBytes: 499, brotliBytes: 399 },
    ];

    expect(evaluateBundleBudgets(sizes, budgets)).toContainEqual(
      expect.objectContaining({
        entry: 'embed',
        encoding: 'missing',
      }),
    );
  });
});
