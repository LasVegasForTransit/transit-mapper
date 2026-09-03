import { describe, expect, it } from 'vitest';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { projectResolvedLineScene } from '../../src/line/resolved-line-scene';
import { aLineSpanResult, lineSpanPresentation } from '../support/line-spans.test';

describe('resolved Line scene', () => {
  it('projects host-resolved network facts into a Line-owned render scene', async () => {
    const sourceId = systemFeatureSourceId('line-visuals');
    const projected = await projectResolvedLineScene({
      result: aLineSpanResult(),
      presentation: lineSpanPresentation,
      sceneRevision: 'line-scene-test',
      sourceId,
    });

    const features = projected.scene.featuresBySource.get(sourceId)?.features ?? [];
    const stripes = features.filter((feature) => feature.properties?.routeRole === 'stripe');
    const casings = features.filter((feature) => feature.properties?.routeRole === 'casing');

    expect(casings).toHaveLength(1);
    expect(stripes).toHaveLength(1);
    expect(stripes[0]?.properties?.lineId).toBe('line');
    expect(projected.scene.identityIndex.renderFeatureIdsByDomain.size).toBe(1);
    expect(projected.lineSpanIdsByLineId.get('line')).toHaveLength(1);
  });
});
