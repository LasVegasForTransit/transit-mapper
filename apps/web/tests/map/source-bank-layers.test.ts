import { describe, expect, it } from 'vitest';
import { LAYER_SPECS } from '../../src/map/layers';
import {
  createSourceBankLayerController,
  isBankedRenderLayer,
  OFFSCREEN_RENDER_TRANSLATE,
  renderLayerTranslateProperties,
} from '../../src/map/source-bank-layers';
import { bankedLayerId, createSourceBankController } from '../../src/map/source-bank';

function paintProperties(spec: (typeof LAYER_SPECS)[number]): Record<string, unknown> {
  return spec.paint ?? {};
}

describe('render source bank layer controller', () => {
  it('flips the complete real layer set in one measured synchronous operation', () => {
    const bankController = createSourceBankController();
    const transaction = bankController.begin({ logicalSourceIds: ['tm-ways'] });
    transaction.recordLoaded(transaction.sourceIds[0]);
    transaction.activate({ revision: 'one', residentFeatureCount: 1 });
    const banked = LAYER_SPECS.filter(isBankedRenderLayer);
    const existing = new Set(
      banked.flatMap((spec) => [bankedLayerId(spec.id, 'a'), bankedLayerId(spec.id, 'b')]),
    );
    const operations: Array<[string, string]> = [];
    const paintOperations: Array<[string, string, unknown]> = [];
    const times = [10, 11.5];
    const layers = createSourceBankLayerController({
      bankController,
      logicalSpecs: LAYER_SPECS,
      host: {
        hasLayer: (layerId) => existing.has(layerId),
        setVisibility: (layerId, visibility) => operations.push([layerId, visibility]),
        setPaintProperty: (layerId, property, value) =>
          paintOperations.push([layerId, property, value]),
      },
      now: () => times.shift() ?? 11.5,
    });

    const result = layers.activate('a');

    const expectedOperationCount = banked.reduce(
      (count, spec) => count + (1 + renderLayerTranslateProperties(spec).length * 2) * 2,
      0,
    );
    expect(result.operationCount).toBe(expectedOperationCount);
    expect(result.durationMs).toBe(1.5);
    for (const spec of banked) {
      const expected = spec.layout?.visibility ?? 'visible';
      expect(operations).toContainEqual([bankedLayerId(spec.id, 'a'), expected]);
      expect(operations).toContainEqual([bankedLayerId(spec.id, 'b'), expected]);
      for (const property of renderLayerTranslateProperties(spec)) {
        const paint = paintProperties(spec);
        expect(paintOperations).toContainEqual([bankedLayerId(spec.id, 'a'), property, [0, 0]]);
        expect(paintOperations).toContainEqual([
          bankedLayerId(spec.id, 'b'),
          property,
          OFFSCREEN_RENDER_TRANSLATE,
        ]);
        expect(paintOperations).toContainEqual([
          bankedLayerId(spec.id, 'a'),
          `${property}-anchor`,
          paint[`${property}-anchor`] ?? 'map',
        ]);
        expect(paintOperations).toContainEqual([
          bankedLayerId(spec.id, 'b'),
          `${property}-anchor`,
          'viewport',
        ]);
      }
    }
    expect(bankController.snapshot()).toMatchObject({
      lastFlipDurationMs: 1.5,
      maxFlipDurationMs: 1.5,
      lastFlipOperationCount: expectedOperationCount,
    });
  });

  it('retains dynamic halo visibility across alternating banks and style rebuilds', () => {
    const bankController = createSourceBankController();
    const visible = new Map<string, string>();
    const existing = new Set(
      LAYER_SPECS.filter(isBankedRenderLayer).flatMap((spec) => [
        bankedLayerId(spec.id, 'a'),
        bankedLayerId(spec.id, 'b'),
      ]),
    );
    const layers = createSourceBankLayerController({
      bankController,
      logicalSpecs: LAYER_SPECS,
      host: {
        hasLayer: (layerId) => existing.has(layerId),
        setVisibility: (layerId, visibility) => visible.set(layerId, visibility),
        setPaintProperty() {},
      },
      now: () => 0,
    });
    layers.setLogicalVisibility('tm-way-selected', 'visible');
    layers.activate('a');
    expect(visible.get(bankedLayerId('tm-way-selected', 'a'))).toBe('visible');

    layers.prepare('b');
    layers.activate('b');
    layers.finishActivation('b');
    expect(visible.get(bankedLayerId('tm-way-selected', 'a'))).toBe('none');
    expect(visible.get(bankedLayerId('tm-way-selected', 'b'))).toBe('visible');
    layers.restore('b');
    expect(visible.get(bankedLayerId('tm-way-selected', 'b'))).toBe('visible');
  });

  it('prepares hidden symbols offscreen without opacity or collision side effects', () => {
    const bankController = createSourceBankController();
    const transaction = bankController.begin({ logicalSourceIds: ['tm-stations'] });
    transaction.recordLoaded(transaction.sourceIds[0]);
    transaction.activate({ revision: 'one', residentFeatureCount: 1 });
    const label = LAYER_SPECS.find((spec) => spec.id === 'tm-station-labels-major');
    if (!label) throw new Error('Expected the major station label layer.');
    const visible = new Map<string, string>();
    const paint = new Map<string, unknown>();
    const existing = new Set([bankedLayerId(label.id, 'a'), bankedLayerId(label.id, 'b')]);
    const layers = createSourceBankLayerController({
      bankController,
      logicalSpecs: [label],
      host: {
        hasLayer: (layerId) => existing.has(layerId),
        setVisibility: (layerId, visibility) => visible.set(layerId, visibility),
        setPaintProperty: (layerId, property, value) => paint.set(`${layerId}:${property}`, value),
      },
      now: () => 0,
    });

    layers.prepare('b');

    expect(layers.stagingBankId()).toBe('b');
    expect(visible.get(bankedLayerId(label.id, 'b'))).toBe('visible');
    expect(paint.get(`${bankedLayerId(label.id, 'b')}:text-translate`)).toBe(
      OFFSCREEN_RENDER_TRANSLATE,
    );
    expect(paint.get(`${bankedLayerId(label.id, 'b')}:text-translate-anchor`)).toBe('viewport');
    layers.finishStaging('b');
    expect(layers.stagingBankId()).toBeNull();
  });

  it('restores outgoing translations after an activated bank render is rejected', () => {
    const bankController = createSourceBankController();
    const first = bankController.begin({ logicalSourceIds: ['tm-ways'] });
    first.recordLoaded(first.sourceIds[0]);
    first.activate({ revision: 'one', residentFeatureCount: 1 });
    first.confirmActivation();
    const way = LAYER_SPECS.find((spec) => spec.id === 'tm-ways-solid');
    if (!way) throw new Error('Expected the solid way layer.');
    const visibility = new Map<string, string>();
    const paint = new Map<string, unknown>();
    const layers = createSourceBankLayerController({
      bankController,
      logicalSpecs: [way],
      host: {
        hasLayer: () => true,
        setVisibility: (layerId, value) => visibility.set(layerId, value),
        setPaintProperty: (layerId, property, value) => paint.set(`${layerId}:${property}`, value),
      },
      now: () => 0,
    });
    layers.restore('a');
    const failed = bankController.begin({ logicalSourceIds: ['tm-ways'] });
    failed.recordLoaded(failed.sourceIds[0]);
    layers.prepare('b');
    failed.activate({ revision: 'two', residentFeatureCount: 2 });
    layers.activate('b');

    failed.abort();
    layers.restore(bankController.activeBank() ?? 'a');

    expect(visibility.get(bankedLayerId(way.id, 'a'))).toBe('visible');
    expect(visibility.get(bankedLayerId(way.id, 'b'))).toBe('none');
    expect(paint.get(`${bankedLayerId(way.id, 'a')}:line-translate`)).toEqual([0, 0]);
    expect(paint.get(`${bankedLayerId(way.id, 'a')}:line-translate-anchor`)).toBe('map');
    expect(paint.get(`${bankedLayerId(way.id, 'b')}:line-translate`)).toBe(
      OFFSCREEN_RENDER_TRANSLATE,
    );
  });
});
