import type { LngLat } from '../geography/bounds';

export interface MapCamera {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapPresentation {
  camera: MapCamera;
  representationId: string;
}
