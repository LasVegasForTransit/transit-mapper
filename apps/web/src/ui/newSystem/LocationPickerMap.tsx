import type { Ref } from 'react';
import type { LngLat } from '@transitmapper/core/model/system';
import {
  useLocationPickerMap,
  type LocationPickerMapHandle,
  type PickerCamera,
} from './use-location-picker-map';

export type { LocationPickerMapHandle } from './use-location-picker-map';

interface LocationPickerMapProps {
  onPick: (center: LngLat) => void;
  onCameraChange?: (camera: PickerCamera) => void;
  handleRef: Ref<LocationPickerMapHandle>;
}

/** Independent plain MapLibre basemap for framing a new system's import. It
 * never reads the editor store or renders transit layers, so camera changes
 * remain isolated from the active document until confirmation. */
export function LocationPickerMap(props: LocationPickerMapProps) {
  const containerRef = useLocationPickerMap(props);
  return <div ref={containerRef} className="location-picker-map" />;
}
