import { describe, expect, it } from 'vitest';
import { createRenderSettlementMarker } from '../../src/map/render-settlement-marker';

describe('render settlement markers', () => {
  it('clears stale state before a render and marks only the completed render', () => {
    const element = { dataset: { renderSettled: 'true' } };
    const marker = createRenderSettlementMarker(element);

    expect(element.dataset.renderSettled).toBeUndefined();
    marker.markSettled();
    expect(element.dataset.renderSettled).toBe('true');
    marker.clear();
    expect(element.dataset.renderSettled).toBeUndefined();
  });
});
