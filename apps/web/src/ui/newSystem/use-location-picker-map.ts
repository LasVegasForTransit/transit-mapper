import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { ImportBBox } from '@transitmapper/core/model/import';
import type { LngLat } from '@transitmapper/core/model/system';
import { basemapStyleForScheme } from '../../map/mapTheme';
import { useSystemColorScheme } from '../../theme/systemColorScheme';

export interface PickerCamera {
  center: LngLat;
  zoom: number;
  bounds: ImportBBox;
}

export interface LocationPickerMapHandle {
  flyTo: (center: LngLat, zoom: number) => Promise<void>;
  fitBounds: (bounds: ImportBBox) => Promise<void>;
  getCamera: () => PickerCamera | null;
}

interface UseLocationPickerMapOptions {
  onPick: (center: LngLat) => void;
  onCameraChange?: (camera: PickerCamera) => void;
  handleRef: Ref<LocationPickerMapHandle>;
}

function cameraFrom(map: MLMap): PickerCamera {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
  };
}

function setMarker(map: MLMap, marker: { current: maplibregl.Marker | null }, center: LngLat) {
  if (!marker.current) {
    marker.current = new maplibregl.Marker({ color: '#e5471a' }).setLngLat(center).addTo(map);
  } else marker.current.setLngLat(center);
}

function waitForMove(map: MLMap, move: () => void): Promise<void> {
  return new Promise((resolve) => {
    map.once('moveend', resolve);
    move();
  });
}

export function useLocationPickerMap({
  onPick,
  onCameraChange,
  handleRef,
}: UseLocationPickerMapOptions) {
  const scheme = useRef(useSystemColorScheme()).current;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const onCameraRef = useRef(onCameraChange);
  onPickRef.current = onPick;
  onCameraRef.current = onCameraChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleForScheme(scheme),
      center: [-98.5, 39.8],
      zoom: 3,
      attributionControl: false,
    });
    mapRef.current = map;
    const click = (event: maplibregl.MapMouseEvent) => {
      const center: LngLat = [event.lngLat.lng, event.lngLat.lat];
      setMarker(map, markerRef, center);
      onPickRef.current(center);
    };
    const report = () => onCameraRef.current?.(cameraFrom(map));
    map.on('click', click);
    map.on('moveend', report);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    return () => {
      map.off('click', click);
      map.off('moveend', report);
      resize.disconnect();
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [scheme]);

  useImperativeHandle(
    handleRef,
    () => ({
      flyTo: (center, zoom) => {
        const map = mapRef.current;
        if (!map) return Promise.resolve();
        setMarker(map, markerRef, center);
        return waitForMove(map, () => map.flyTo({ center, zoom, duration: 600 }));
      },
      fitBounds: (bounds) => {
        const map = mapRef.current;
        if (!map) return Promise.resolve();
        return waitForMove(map, () =>
          map.fitBounds(
            [
              [bounds.west, bounds.south],
              [bounds.east, bounds.north],
            ],
            {
              padding: 40,
              duration: 600,
              maxZoom: 12,
            },
          ),
        );
      },
      getCamera: () => (mapRef.current ? cameraFrom(mapRef.current) : null),
    }),
    [],
  );

  return containerRef;
}
