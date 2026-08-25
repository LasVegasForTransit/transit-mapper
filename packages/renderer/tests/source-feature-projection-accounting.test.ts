import { describe, expect, it } from 'vitest';
import { createSourceFeatureProjectionAccounting } from '../src/committed-feature-projection';

describe('source feature projection accounting', () => {
  it('publishes only accepted generation-local counts when projections overlap', () => {
    const accounting = createSourceFeatureProjectionAccounting();
    const committed = accounting.begin();
    const editor = accounting.begin();

    committed.counts.featureTopologyWayVisitCount = 400;
    committed.counts.rendererGeneratedFeatureCount = 800;
    editor.counts.featureHandleWayVisitCount = 3;
    editor.counts.rendererGeneratedFeatureCount = 6;

    editor.accept();
    committed.discard();

    expect(accounting.snapshot()).toMatchObject({
      featureTopologyWayVisitCount: 0,
      featureHandleWayVisitCount: 3,
      rendererGeneratedFeatureCount: 6,
    });
  });

  it('settles each transaction once so a terminal callback cannot double count', () => {
    const accounting = createSourceFeatureProjectionAccounting();
    const transaction = accounting.begin();
    transaction.counts.featureStopVisitCount = 2;

    expect(transaction.accept()).toBe(true);
    expect(transaction.accept()).toBe(false);
    expect(transaction.discard()).toBe(false);
    expect(accounting.snapshot().featureStopVisitCount).toBe(2);
  });
});
