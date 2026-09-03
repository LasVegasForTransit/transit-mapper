import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapFeatureReferenceV1 } from '@transitmapper/core/presentation/map-presentation-state';
import type { MapViewStore } from './map-view-store';
import type { SelectionController } from './selection-controller';
import type { MapStartupMilestones } from './startup-milestones';

export interface MapRepresentationDefinition {
  id: string;
  label: string;
}

export interface MapFilterOption {
  id: string;
  label: string;
}

export type MapFilterDefinition =
  | {
      kind: 'toggle';
      id: string;
      label: string;
      defaultValue: boolean;
    }
  | {
      kind: 'multi-select';
      id: string;
      label: string;
      options: readonly MapFilterOption[];
      defaultValue: readonly string[];
    };

export interface MapAttribution {
  label: string;
  url?: string;
}

export interface MapDefinition {
  id: string;
  title: string;
  representations: readonly MapRepresentationDefinition[];
  filters: readonly MapFilterDefinition[];
  attribution: readonly MapAttribution[];
}

export interface MapFeatureDetails {
  reference: MapFeatureReferenceV1;
  title: string;
  fields: readonly { label: string; value: string }[];
}

export interface MapRuntimeHost {
  map: MapLibreMap;
  reportError(error: unknown): void;
}

export interface MapDriverAttachOptions {
  host: MapRuntimeHost;
  viewStore: MapViewStore;
  selection: SelectionController;
  milestones: MapStartupMilestones;
  signal: AbortSignal;
}

export interface MapDriver {
  readonly definition: MapDefinition;
  attach(options: MapDriverAttachOptions): Promise<MapDriverAttachment>;
}

export interface MapDriverAttachment {
  resolveFeature(
    reference: MapFeatureReferenceV1,
    signal: AbortSignal,
  ): Promise<MapFeatureDetails | null>;
  dispose(): void;
}
