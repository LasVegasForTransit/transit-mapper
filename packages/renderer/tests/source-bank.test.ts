import { describe, expect, it } from 'vitest';
import {
  bankedLayerId,
  bankedSourceId,
  createSourceBankController,
} from '../src/sources/source-bank';

const WAYS = 'tm-ways';
const STATIONS = 'tm-stations';
const HITS = 'tm-hit-features';

describe('render source bank controller', () => {
  it('keeps the active revision visible while every hidden source loads', () => {
    const controller = createSourceBankController();
    const first = controller.begin({ logicalSourceIds: [WAYS, HITS] });
    for (const sourceId of first.sourceIds) first.recordLoaded(sourceId);
    first.activate({ revision: 'one', residentFeatureCount: 12 });
    const activeSource = controller.activeSourceId(WAYS);

    const next = controller.begin({
      logicalSourceIds: Array.from({ length: 17 }, (_, index) => `tm-source-${index}`),
    });
    for (const sourceId of next.sourceIds) {
      next.recordLoaded(sourceId);
      expect(controller.activeRevision()).toBe('one');
      expect(controller.activeSourceId(WAYS)).toBe(activeSource);
    }

    next.activate({ revision: 'two', residentFeatureCount: 34 });
    expect(controller.activeRevision()).toBe('two');
    expect(controller.activeSourceId(WAYS)).not.toBe(activeSource);
  });

  it('requires every exact hidden source before one visibility and hit-owner flip', () => {
    const controller = createSourceBankController();
    const transaction = controller.begin({ logicalSourceIds: [WAYS, STATIONS, HITS] });
    transaction.recordLoaded(bankedSourceId(WAYS, transaction.bank));
    transaction.recordLoaded(bankedSourceId(STATIONS, transaction.bank));

    expect(() => transaction.activate({ revision: 'incomplete', residentFeatureCount: 3 })).toThrow(
      'exact hidden source set',
    );
    expect(controller.activeBank()).toBeNull();

    transaction.recordLoaded(bankedSourceId(HITS, transaction.bank));
    transaction.activate({ revision: 'complete', residentFeatureCount: 3 });
    expect(controller.activeSourceId(HITS)).toBe(
      bankedSourceId(HITS, controller.activeBank() ?? 'a'),
    );
  });

  it('leaves active source and hit ownership untouched when staging aborts', () => {
    const controller = createSourceBankController();
    const first = controller.begin({ logicalSourceIds: [WAYS, HITS] });
    for (const sourceId of first.sourceIds) first.recordLoaded(sourceId);
    first.activate({ revision: 'accepted', residentFeatureCount: 10 });
    const activeBank = controller.activeBank();
    const activeHitSource = controller.activeSourceId(HITS);

    const failed = controller.begin({ logicalSourceIds: [WAYS, HITS] });
    failed.recordLoaded(failed.sourceIds[0]);
    failed.abort();

    expect(controller.activeBank()).toBe(activeBank);
    expect(controller.activeSourceId(HITS)).toBe(activeHitSource);
    expect(controller.activeRevision()).toBe('accepted');
    expect(controller.snapshot().abortCount).toBe(1);
  });

  it('alternates banks against their stable resident revisions and reports bounded counters', () => {
    const controller = createSourceBankController();
    for (const [revision, featureCount] of [
      ['one', 10],
      ['two', 20],
      ['three', 30],
    ] as const) {
      const transaction = controller.begin({ logicalSourceIds: [WAYS] });
      for (const sourceId of transaction.sourceIds) transaction.recordLoaded(sourceId);
      transaction.activate({ revision, residentFeatureCount: featureCount });
    }

    expect(controller.activeBank()).toBe('a');
    expect(controller.residentRevision('a')).toBe('three');
    expect(controller.residentRevision('b')).toBe('two');
    expect(controller.snapshot()).toMatchObject({
      bankedTransactionCount: 3,
      flipCount: 3,
      hiddenSourceLoadCount: 3,
      abortCount: 0,
      residentFeatureCountByBank: { a: 30, b: 20 },
    });
  });

  it('keeps deterministic source and layer identities across style rebuilds', () => {
    const controller = createSourceBankController();
    const transaction = controller.begin({ logicalSourceIds: [WAYS] });
    transaction.recordLoaded(transaction.sourceIds[0]);
    transaction.activate({ revision: 'accepted', residentFeatureCount: 1 });

    expect(controller.activeLayerId('tm-ways-solid')).toBe(bankedLayerId('tm-ways-solid', 'a'));
    controller.noteStyleRebuild();
    expect(controller.activeBank()).toBe('a');
    expect(controller.activeRevision()).toBe('accepted');
    expect(controller.snapshot().styleRebuildCount).toBe(1);
  });

  it('retains a preseeded hidden bank without changing active ownership', () => {
    const controller = createSourceBankController();
    const active = controller.begin({ logicalSourceIds: [WAYS] });
    active.recordLoaded(active.sourceIds[0]);
    active.activate({ revision: 'one', residentFeatureCount: 2 });
    const seed = controller.begin({ logicalSourceIds: [WAYS] });
    seed.recordLoaded(seed.sourceIds[0]);
    seed.retain({ revision: 'one', residentFeatureCount: 2 });

    expect(controller.activeBank()).toBe('a');
    expect(controller.residentRevision('b')).toBe('one');
    expect(controller.snapshot()).toMatchObject({ flipCount: 1, bankedTransactionCount: 2 });
  });
});
