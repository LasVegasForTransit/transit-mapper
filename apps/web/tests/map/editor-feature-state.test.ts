import type { Map as MLMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { Selection } from '../../src/editor/store';
import {
  createEditorFeatureState,
  type RenderedFeatureIdentity,
} from '../../src/map/editor-feature-state';
import { LYR_SERVICES_SOLID, LYR_WAY_SELECTED, SRC_WAYS } from '@transitmapper/renderer/layers';
import type { LiveMapRenderer } from '@transitmapper/renderer/runtime';

interface FeatureStateChange {
  readonly target: RenderedFeatureIdentity;
  readonly key: 'hover' | 'selected';
  readonly value: boolean;
}

class RecordingMap {
  readonly changes: FeatureStateChange[] = [];
  repaintCount = 0;

  getSource(_sourceId: string): object {
    return {};
  }

  setFeatureState(
    target: RenderedFeatureIdentity,
    state: Partial<Record<'hover' | 'selected', boolean>>,
  ): void {
    for (const [key, value] of Object.entries(state)) {
      this.changes.push({
        target,
        key: key as 'hover' | 'selected',
        value,
      });
    }
  }

  removeFeatureState(target: RenderedFeatureIdentity, key: 'hover' | 'selected'): void {
    this.changes.push({ target, key, value: false });
  }

  triggerRepaint(): void {
    this.repaintCount += 1;
  }
}

class RecordingRenderer {
  activeBank: 'a' | 'b' = 'a';
  readonly visibility: Array<{ layerId: string; value: 'visible' | 'none' }> = [];
  readonly paint: Array<{ layerId: string; property: string }> = [];

  activeSourceId(logicalSourceId: string): string {
    return `${logicalSourceId}--bank-${this.activeBank}`;
  }

  targetsForDomainIdentity(): readonly [{ sourceId: typeof SRC_WAYS; featureId: string }] {
    return [{ sourceId: SRC_WAYS, featureId: 'render:way:west' }];
  }

  setLayerVisibility(layerId: string, value: 'visible' | 'none'): void {
    this.visibility.push({ layerId, value });
  }

  setLayerPaintProperty(layerId: string, property: string): void {
    this.paint.push({ layerId, property });
  }
}

describe('editor feature state', () => {
  it('moves selection and hover state together when the accepted source bank changes', () => {
    const map = new RecordingMap();
    const renderer = new RecordingRenderer();
    const selection: Selection = { kind: 'way', id: 'west' };
    const state = createEditorFeatureState({
      map: map as unknown as MLMap,
      renderer: renderer as unknown as LiveMapRenderer,
      readSelection: () => selection,
    });

    state.applySelection();
    state.setHoveredFeature({ source: `${SRC_WAYS}--bank-a`, id: 'render:way:east' });
    renderer.activeBank = 'b';
    state.restoreAfterStyle();

    expect(state.selectedSourceIds()).toEqual([`${SRC_WAYS}--bank-b`]);
    expect(map.changes).toContainEqual({
      target: { source: `${SRC_WAYS}--bank-a`, id: 'render:way:west' },
      key: 'selected',
      value: false,
    });
    expect(map.changes).toContainEqual({
      target: { source: `${SRC_WAYS}--bank-b`, id: 'render:way:west' },
      key: 'selected',
      value: true,
    });
    expect(map.changes).toContainEqual({
      target: { source: `${SRC_WAYS}--bank-b`, id: 'render:way:east' },
      key: 'hover',
      value: true,
    });
    expect(renderer.visibility).toContainEqual({ layerId: LYR_WAY_SELECTED, value: 'visible' });
    expect(renderer.paint).toContainEqual({
      layerId: LYR_SERVICES_SOLID,
      property: 'line-opacity',
    });
    expect(map.repaintCount).toBeGreaterThan(0);
  });
});
