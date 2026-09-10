import { describe, expect, it } from 'vitest';

import { nextCount } from '../src/lib/counter';

describe('nextCount', () => {
  it('adds one', () => {
    expect(nextCount(2)).toBe(3);
  });

  it('never goes below one', () => {
    expect(nextCount(-5)).toBe(1);
  });
});
