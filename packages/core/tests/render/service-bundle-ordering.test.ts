import { describe, expect, it } from 'vitest';
import { orderServiceBundles } from '../../src/render/service-bundle-ordering';

describe('service bundle ordering', () => {
  it('centers a solo service on its corridor', () => {
    const ordering = orderServiceBundles(new Map([['main', ['red']]]));

    expect(ordering.serviceIdsOn('main')).toEqual(['red']);
    expect(ordering.slotFor('red', 'main')).toBe(0);
  });

  it('keeps a shared service order when source collections disagree', () => {
    const ordering = orderServiceBundles(
      new Map([
        ['north', ['blue', 'red']],
        ['trunk', ['red', 'blue']],
      ]),
      { serviceOrder: ['red', 'blue'] },
    );

    expect(ordering.serviceIdsOn('north')).toEqual(['red', 'blue']);
    expect(ordering.serviceIdsOn('trunk')).toEqual(['red', 'blue']);
    expect(ordering.slotFor('red', 'north')).toBe(-0.5);
    expect(ordering.slotFor('blue', 'north')).toBe(0.5);
  });

  it('preserves every shared pair through a bundle split', () => {
    const ordering = orderServiceBundles(
      new Map([
        ['north', ['blue', 'red']],
        ['south', ['green', 'blue']],
        ['trunk', ['green', 'red', 'blue']],
      ]),
      { serviceOrder: ['red', 'blue', 'green'] },
    );

    expect(ordering.serviceIdsOn('trunk')).toEqual(['red', 'blue', 'green']);
    expect(ordering.serviceIdsOn('north')).toEqual(['red', 'blue']);
    expect(ordering.serviceIdsOn('south')).toEqual(['blue', 'green']);
    expect(ordering.slotFor('red', 'trunk')).toBeLessThan(ordering.slotFor('blue', 'trunk'));
    expect(ordering.slotFor('red', 'north')).toBeLessThan(ordering.slotFor('blue', 'north'));
    expect(ordering.slotFor('blue', 'trunk')).toBeLessThan(ordering.slotFor('green', 'trunk'));
    expect(ordering.slotFor('blue', 'south')).toBeLessThan(ordering.slotFor('green', 'south'));
  });

  it('uses service ids as a deterministic fallback when no public order exists', () => {
    const ordering = orderServiceBundles(new Map([['trunk', ['zeta', 'alpha', 'mu']]]));

    expect(ordering.serviceIdsOn('trunk')).toEqual(['alpha', 'mu', 'zeta']);
    expect(ordering.slotFor('alpha', 'trunk')).toBe(-1);
    expect(ordering.slotFor('mu', 'trunk')).toBe(0);
    expect(ordering.slotFor('zeta', 'trunk')).toBe(1);
  });
});
