import { describe, expect, it } from 'vitest';
import { LAYER_SPECS } from '../../src/map/layers';
import {
  sourceBankLayerSpecs,
  isBankedRenderLayer,
  OFFSCREEN_RENDER_TRANSLATE,
  renderLayerTranslateProperties,
} from '@transitmapper/renderer/layers';
import { bankedLayerId, bankedSourceId } from '@transitmapper/renderer/layers';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '@transitmapper/renderer/layers';
import { SRC_HIT_FEATURES } from '@transitmapper/renderer/layers';

describe('banked renderer layer specifications', () => {
  it('duplicates only committed visual and hit layers in exact paint order', () => {
    const result = sourceBankLayerSpecs(LAYER_SPECS);
    const logicalBanked = LAYER_SPECS.filter(isBankedRenderLayer);

    for (const bank of ['a', 'b'] as const) {
      const bankSpecs = result.filter((spec) => spec.id.endsWith(`--bank-${bank}`));
      expect(bankSpecs.map((spec) => spec.id)).toEqual(
        logicalBanked.map((spec) => bankedLayerId(spec.id, bank)),
      );
      expect(bankSpecs.map((spec) => ('source' in spec ? spec.source : undefined))).toEqual(
        logicalBanked.map((spec) => bankedSourceId('source' in spec ? spec.source : '', bank)),
      );
      for (let index = 0; index < bankSpecs.length; index += 1) {
        expect(bankSpecs[index].layout?.visibility).toBe('none');
        for (const property of renderLayerTranslateProperties(logicalBanked[index])) {
          const paint = bankSpecs[index].paint as Record<string, unknown>;
          expect(paint[property]).toBe(OFFSCREEN_RENDER_TRANSLATE);
          expect(paint[`${property}-anchor`]).toBe('viewport');
          expect(paint[`${property}-transition`]).toEqual({ duration: 0, delay: 0 });
        }
      }
    }
  });

  it('leaves transient editor, vehicle, gesture, preview, and context layers single', () => {
    const result = sourceBankLayerSpecs(LAYER_SPECS);
    const unbanked = LAYER_SPECS.filter((spec) => !isBankedRenderLayer(spec));
    expect(result.filter((spec) => !spec.id.includes('--bank-'))).toEqual(unbanked);
  });

  it('banks exactly the committed system sources plus stable hit geometry', () => {
    const bankedSources = new Set(
      LAYER_SPECS.filter(isBankedRenderLayer).map((spec) => ('source' in spec ? spec.source : '')),
    );
    expect(bankedSources).toEqual(new Set([...COMMITTED_SYSTEM_FEATURE_SOURCES, SRC_HIT_FEATURES]));
  });
});
