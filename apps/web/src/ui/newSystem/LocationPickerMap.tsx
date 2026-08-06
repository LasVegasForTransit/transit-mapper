import { useEffect, useImperativeHandle, useRef } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { LngLat } from '@transitmapper/core/model/system';
import type { ImportBBox } from '@transitmapper/core/model/import';
import { basemapStyleForScheme } from '../../map/mapTheme';
import { useSystemColorScheme } from '../../theme/systemColorScheme';

/**
 * A fourth, independent MapLibre instance (alongside the main editor map,
 * ExportPreviewMap, and OnboardingPreviewMap) — a plain real basemap with a
 * single picked-point marker, for choosing where a new system's starting
 * streets come from. No transit layers/sources at all: this map never shows
 * a TransitSystem, only OSM's own tiles, so it stays completely decoupled
 * from the editor store.
 */
export interface LocationPickerMapHandle {
  /** Resolves once the camera has actually settled at (center, zoom) — the
   *  caller reads getBounds() only after this resolves, so the bbox it
   *  computes matches what's on screen instead of a stale prior view. */
  flyTo: (center: LngLat, zoom: number) => Promise<void>;
  /** Same "current view at whatever zoom the map is at" convention
   *  ImportDialog.tsx uses (map.getBounds()), not an approximation from
   *  center+zoom alone. */
  getBounds: () => ImportBBox | null;
}

interface LocationPickerMapProps {
  onPick: (center: LngLat) => void;
  handleRef: React.Ref<LocationPickerMapHandle>;
}

export function LocationPickerMap({ onPick, handleRef }: LocationPickerMapProps) {
  const colorScheme = useSystemColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleForScheme(colorScheme),
      center: [-98.5, 39.8], // continental-US default; flyTo immediately overrides once a place is picked
      zoom: 3,
      attributionControl: false,
    });
    mapRef.current = map;

    const placeMarker = (center: LngLat) => {
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({ color: '#e5471a' })
          .setLngLat(center)
          .addTo(map);
      } else {
        markerRef.current.setLngLat(center);
      }
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const center: LngLat = [e.lngLat.lng, e.lngLat.lat];
      placeMarker(center);
      onPickRef.current(center);
    };
    map.on('click', onClick);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      map.off('click', onClick);
      ro.disconnect();
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      flyTo: (center, zoom) =>
        new Promise<void>((resolve) => {
          const map = mapRef.current;
          if (!map) {
            resolve();
            return;
          }
          if (!markerRef.current) {
            markerRef.current = new maplibregl.Marker({ color: '#e5471a' })
              .setLngLat(center)
              .addTo(map);
          } else {
            markerRef.current.setLngLat(center);
          }
          map.once('moveend', () => resolve());
          map.flyTo({ center, zoom, duration: 600 });
        }),
      getBounds: () => {
        const map = mapRef.current;
        if (!map) return null;
        const b = map.getBounds();
        return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      },
    }),
    [],
  );

  return <div ref={containerRef} className="location-picker-map" />;
}
