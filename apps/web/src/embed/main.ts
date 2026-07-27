import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { systemBounds } from '@transitmapper/core/model/geo';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { buildFeatures, type ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { GetShareResponse } from '@transitmapper/core/share/contract';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { BASEMAP_STYLE } from '../map/basemap';
import {
  LAYER_SPECS,
  registerMapIcons,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from '../map/layers';

// The embedded map: a live, read-only view of one shared system, meant to sit
// in someone else's article. Deliberately NOT the editor with its chrome
// hidden — an embed competes with the host page's load budget, so this entry
// pulls in MapLibre and core's feature builder and nothing else. No React, no
// editor store, no toolbars, no inspector.
//
// It shows the schematic (Network view). Infrastructure detail is a planning
// tool; someone reading a blog post wants to see the lines.

const EMBED_VIEW: ViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
};

// Only the sources a read-only schematic actually feeds. The editor's handle,
// preview, marquee and lane-detail sources have no meaning here, but the
// shared LAYER_SPECS reference them, so they're still created (empty) — a
// layer whose source is missing is a hard MapLibre error.
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

function shareIdFromPath(pathname: string): string | null {
  const match = /^\/e\/([0-9a-z]{1,32})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

function fail(message: string): void {
  const el = document.getElementById('embed-status');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

async function loadSystem(id: string): Promise<TransitSystem> {
  const res = await fetch(`/api/systems/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('This shared system was not found.');
  if (!res.ok) throw new Error(`Couldn't load this system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}

function mount(system: TransitSystem): void {
  const container = document.getElementById('map');
  if (!container) return;

  const map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: system.viewport.center,
    zoom: system.viewport.zoom,
    // An embed is a reading surface, not an editing one: pan and zoom are
    // welcome, rotation and pitch just let a reader get lost.
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: true,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // An embed lives at whatever size the host page decides, and that size can
  // change after load — a responsive article column, a lazy-loaded iframe that
  // was display:none a moment ago, a reader rotating their phone. MapLibre
  // only measures its container once, at construction, and falls back to
  // 400x300 if the container had no size yet; without this the map paints into
  // a small corner of the frame forever.
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(container);
  map.on('remove', () => resizeObserver.disconnect());

  // MapLibre reports style/source/layer failures through its own event, not by
  // throwing. Without this an embed that half-renders does so in total silence,
  // which is the worst possible failure mode for something running inside
  // someone else's page.
  map.on('error', (e) => console.error('[transitmapper embed]', e.error ?? e));

  map.on('load', () => {
    // Everything below runs inside MapLibre's own event dispatch, which
    // swallows what it catches — an exception here would otherwise leave a
    // half-drawn map and no explanation anywhere.
    try {
      registerMapIcons(map);

      // Same add-then-anchor ordering the editor uses (see MapCanvas), minus
      // the self-healing: nothing here mutates the style after setup, so
      // there's no torn state to heal. Sources are derived from the specs
      // themselves rather than listed by hand, so a layer can never reference
      // a source this forgot to create.
      const sources = new Set(
        LAYER_SPECS.map((spec) => ('source' in spec ? (spec.source as string) : '')).filter(
          Boolean,
        ),
      );
      for (const src of sources) {
        if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: EMPTY_FC });
      }
      for (const spec of LAYER_SPECS) {
        if (!map.getLayer(spec.id)) map.addLayer(spec);
      }

      const fc = buildFeatures(system, null, [], EMBED_VIEW);
      const setData = (id: string, data: GeoJSON.FeatureCollection) => {
        const source = map.getSource(id) as GeoJSONSource | undefined;
        if (!source) throw new Error(`Embed source "${id}" was never created`);
        source.setData(data);
      };
      setData(SRC_WAYS, fc.ways);
      setData(SRC_SERVICES, fc.services);
      setData(SRC_STATIONS, fc.stations);
      setData(SRC_FOOTPRINTS, fc.footprints);
      setData(SRC_PLATFORMS, fc.platforms);
      setData(SRC_FACILITIES, fc.facilities);

      // Resize before framing, never after: fitBounds solves for the viewport
      // it's told about, so fitting against a stale size frames the wrong extent.
      map.resize();
      const bounds = systemBounds(system);
      if (bounds) map.fitBounds(bounds, { padding: 40, animate: false });
      map.triggerRepaint();
    } catch (e) {
      console.error('[transitmapper embed]', e);
      fail(`Couldn't draw this map: ${(e as Error).message}`);
    }
  });
}

async function start(): Promise<void> {
  const id = shareIdFromPath(window.location.pathname);
  if (!id) {
    fail('No system to show.');
    return;
  }

  try {
    const system = await loadSystem(id);
    document.title = `${system.name || 'Transit system'} · TransitMapper`;

    // The credit link doubles as the way out of the iframe — a reader who
    // wants to explore or fork opens the real app in a new tab.
    const credit = document.getElementById('embed-credit');
    if (credit instanceof HTMLAnchorElement) {
      credit.href = `/s/${id}`;
      credit.textContent = system.name ? `${system.name} · TransitMapper` : 'Open in TransitMapper';
    }

    const status = document.getElementById('embed-status');
    if (status) status.hidden = true;

    mount(system);
  } catch (e) {
    fail((e as Error).message);
  }
}

void start();
