/**
 * Paint-only editor state for accepted renderer features.
 *
 * Selection and hover belong to the editor, but their pixels live on the
 * renderer's currently active physical source bank. This object keeps those
 * two identities synchronized. It never projects geometry or uploads source
 * data; the separate editor overlay path owns handles, termini, and guides.
 */
import type { Map as MLMap } from 'maplibre-gl';
import {
  renderDomainIdentity,
  type RenderDomainIdentity,
} from '@transitmapper/core/render/render-identity';
import type { Selection } from '../editor/store';
import type { SceneFeatureTarget } from '@transitmapper/renderer/runtime';
import {
  LYR_FACILITY_SELECTED,
  LYR_JUNCTION_SELECTED,
  LYR_SERVICE_SELECTED,
  LYR_LINE_STRIPE_SELECTED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_STATION_SELECTED,
  LYR_WAY_SELECTED,
  serviceFocusOpacityExpr,
} from '@transitmapper/renderer/layers';
import type { LiveMapRenderer } from '@transitmapper/renderer/runtime';
import { logicalRenderSourceId } from '@transitmapper/renderer/layers';

export interface RenderedFeatureIdentity {
  readonly source: string;
  readonly id: string;
}

export interface EditorFeatureStateOptions {
  readonly map: MLMap;
  readonly renderer: LiveMapRenderer;
  readSelection(): Selection;
}

export type SceneTargetResolver = (
  domainIdentity: RenderDomainIdentity,
) => readonly SceneFeatureTarget[];

const HALO_LAYERS = [
  LYR_WAY_SELECTED,
  LYR_SERVICE_SELECTED,
  LYR_LINE_STRIPE_SELECTED,
  LYR_STATION_SELECTED,
  LYR_FACILITY_SELECTED,
  LYR_JUNCTION_SELECTED,
] as const;

const SERVICE_ROUTE_LAYERS = [
  [LYR_SERVICES_SOLID, 1],
  [LYR_SERVICES_UNDERGROUND, 1],
  [LYR_SERVICES_SOLID_CASING, 0.72],
  [LYR_SERVICES_UNDERGROUND_CASING, 0.72],
] as const;

function hasRenderableSelection(
  selection: Selection,
): selection is Exclude<Selection, { kind: 'group' } | null> {
  return selection !== null && selection.kind !== 'group';
}

export class EditorFeatureState {
  private selectedFeatures: RenderedFeatureIdentity[] = [];
  private hoveredFeature: RenderedFeatureIdentity | null = null;
  private routeFocusActive = false;

  constructor(private readonly options: EditorFeatureStateOptions) {}

  /** Rebinds the current domain selection to stable features in the active bank. */
  applySelection(
    resolveTargets: SceneTargetResolver = (identity) =>
      this.options.renderer.targetsForDomainIdentity(identity),
  ): void {
    this.synchronizeSelection(resolveTargets, false);
  }

  /** Records the rendered feature under the pointer without changing geometry. */
  setHoveredFeature(feature: RenderedFeatureIdentity | null): void {
    if (
      this.hoveredFeature?.source === feature?.source &&
      this.hoveredFeature?.id === feature?.id
    ) {
      return;
    }
    if (this.hoveredFeature) this.removeState(this.hoveredFeature, 'hover');
    this.hoveredFeature = feature;
    if (feature && this.options.map.getSource(feature.source)) {
      this.options.map.setFeatureState(feature, { hover: true });
    }
    this.updateHaloVisibility();
    this.options.map.triggerRepaint();
  }

  /** Replays paint state after a style or source-bank replacement. */
  restoreAfterStyle(): void {
    this.synchronizeSelection(
      (identity) => this.options.renderer.targetsForDomainIdentity(identity),
      true,
    );
  }

  selectedSourceIds(): string[] {
    return [...new Set(this.selectedFeatures.map(({ source }) => source))].sort();
  }

  private synchronizeSelection(
    resolveTargets: SceneTargetResolver,
    forceRouteFocus: boolean,
  ): void {
    for (const feature of this.selectedFeatures) this.removeState(feature, 'selected');
    this.selectedFeatures = [];

    const selection = this.options.readSelection();
    if (hasRenderableSelection(selection)) {
      const identity = renderDomainIdentity(selection.kind, selection.id);
      for (const target of resolveTargets(identity)) this.selectFeature(target);
    }

    this.rebindHoverToActiveBank();
    this.setRouteFocus(selection?.kind === 'service', forceRouteFocus);
    this.updateHaloVisibility();
    this.options.map.triggerRepaint();
  }

  private selectFeature(target: SceneFeatureTarget): void {
    const source = this.options.renderer.activeSourceId(String(target.sourceId));
    if (!this.options.map.getSource(source)) return;
    const feature = { source, id: target.featureId };
    this.options.map.setFeatureState(feature, { selected: true });
    this.selectedFeatures.push(feature);
  }

  private rebindHoverToActiveBank(): void {
    if (!this.hoveredFeature) return;
    this.removeState(this.hoveredFeature, 'hover');
    const source = this.options.renderer.activeSourceId(
      logicalRenderSourceId(this.hoveredFeature.source),
    );
    this.hoveredFeature = { source, id: this.hoveredFeature.id };
    if (this.options.map.getSource(source)) {
      this.options.map.setFeatureState(this.hoveredFeature, { hover: true });
    }
  }

  private setRouteFocus(active: boolean, force: boolean): void {
    if (active === this.routeFocusActive && !force) return;
    this.routeFocusActive = active;
    for (const [layerId, baseOpacity] of SERVICE_ROUTE_LAYERS) {
      this.options.renderer.setLayerPaintProperty(
        layerId,
        'line-opacity',
        serviceFocusOpacityExpr(baseOpacity, active),
      );
    }
  }

  private updateHaloVisibility(): void {
    const visibility =
      this.selectedFeatures.length > 0 || this.hoveredFeature !== null ? 'visible' : 'none';
    for (const layerId of HALO_LAYERS) {
      this.options.renderer.setLayerVisibility(layerId, visibility);
    }
  }

  private removeState(feature: RenderedFeatureIdentity, key: 'hover' | 'selected'): void {
    if (this.options.map.getSource(feature.source)) {
      this.options.map.removeFeatureState(feature, key);
    }
  }
}

export function createEditorFeatureState(options: EditorFeatureStateOptions): EditorFeatureState {
  return new EditorFeatureState(options);
}
