/**
 * Selection-dependent geometry that belongs to the editor, not the scene.
 *
 * Handles, service termini, and junction guides may change on every selection
 * without invalidating the accepted network. Keeping them outside the source
 * banks prevents a click from scheduling city-scale committed projection.
 */
import type { Feature, FeatureCollection, LineString } from 'geojson';
import {
  collectWayTrims,
  connectorCurves,
  junctionGeometry,
} from '@transitmapper/core/geometry/junctions';
import { wayById } from '@transitmapper/core/model/geo';
import { profileWidthM } from '@transitmapper/core/model/profile';
import type { TransitSystem, Way } from '@transitmapper/core/model/system';
import { widthPxAtZ14 } from '@transitmapper/core/render/constants';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { EditorState, Selection } from '../editor/store';
import { SRC_CONNECTORS } from './layers/constants';
import type { MapSystemFeatureSourceId } from './system-feature-sources';
import { EDITOR_SYSTEM_FEATURE_SOURCES } from './system-feature-sources';

const CONNECTOR_SOURCE_ID = systemFeatureSourceId(SRC_CONNECTORS);

type RenderedArmedTerminus = Pick<
  NonNullable<EditorState['armedTerminus']>,
  'serviceId' | 'patternId' | 'side'
>;

export interface SelectionRenderState {
  selection: Selection;
  activeWayId: string | null;
  activePatternId: string | null;
  armedTerminus: RenderedArmedTerminus | null;
}

export interface SelectionRenderUpdatePlan {
  updateEditorSources: boolean;
  updateServiceTermini: boolean;
}

const EDITOR_SOURCE_SET = new Set<MapSystemFeatureSourceId>(EDITOR_SYSTEM_FEATURE_SOURCES);

/** Editor-owned handles and guides may refine an accepted scene, but they
 * cannot seed it or interleave with a multi-frame source transaction. */
export function canApplyEditorSourceUpdate(
  hasRetainedScene: boolean,
  sourceSubmissionInFlight: boolean,
): boolean {
  return hasRetainedScene && !sourceSubmissionInFlight;
}

/** Document replacement and any dependency plan touching an editor-owned
 * source must replay its current selected entity even when selection identity
 * itself stayed stable. */
export function editorSourcesNeedSystemRefresh(
  changedSources: readonly MapSystemFeatureSourceId[],
  documentChanged: boolean,
): boolean {
  return documentChanged || changedSources.some((sourceId) => EDITOR_SOURCE_SET.has(sourceId));
}

function selectionKey(selection: Selection): string | null {
  return selection ? `${selection.kind}:${selection.id}` : null;
}

function selectedServiceId(selection: Selection): string | null {
  return selection?.kind === 'service' ? selection.id : null;
}

function armedTerminusKey(terminus: RenderedArmedTerminus | null): string | null {
  return terminus ? `${terminus.serviceId}:${terminus.patternId}:${terminus.side}` : null;
}

/** Classify ephemeral editor changes without involving settled scene
 * projection. Handles, junction guides, and feature state are lightweight;
 * service termini alone still need their small derived source refreshed. */
export function planSelectionRenderUpdate(
  before: SelectionRenderState,
  after: SelectionRenderState,
): SelectionRenderUpdatePlan {
  const beforeServiceId = selectedServiceId(before.selection);
  const afterServiceId = selectedServiceId(after.selection);
  const selectedServiceChanged = beforeServiceId !== afterServiceId;
  const visibleServiceStateChanged =
    afterServiceId !== null &&
    (before.activePatternId !== after.activePatternId ||
      armedTerminusKey(before.armedTerminus) !== armedTerminusKey(after.armedTerminus));

  return {
    updateEditorSources:
      selectionKey(before.selection) !== selectionKey(after.selection) ||
      before.activeWayId !== after.activeWayId,
    updateServiceTermini: selectedServiceChanged || visibleServiceStateChanged,
  };
}

function corridorWidthAtJunction(way: Way | undefined, fallbackLatitude: number): number {
  return way ? widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? fallbackLatitude) : 0;
}

/** Derive the small, selection-owned connector guide source independently of
 * the settled renderer scene. This preserves junction editing feedback while
 * a click updates no city-scale topology or physical geometry collections. */
export function selectedJunctionConnectorFeatures(
  system: TransitSystem,
  selectedNodeId: string | null,
): FeatureCollection<LineString> {
  if (!selectedNodeId) return { type: 'FeatureCollection', features: [] };
  const node = system.nodes.find((candidate) => candidate.id === selectedNodeId);
  if (!node) return { type: 'FeatureCollection', features: [] };

  const waysById = wayById(system.ways);
  const geometry = junctionGeometry(node, waysById);
  if (!geometry) return { type: 'FeatureCollection', features: [] };
  const trims = collectWayTrims([geometry]);
  const features: Feature<LineString>[] = connectorCurves(
    node,
    waysById,
    trims,
    system.turnRestrictions,
  ).map((connector) => ({
    type: 'Feature',
    id: renderFeatureId(CONNECTOR_SOURCE_ID, 'lane-movement', [
      node.id,
      connector.from.wayId,
      connector.from.laneId,
      connector.to.wayId,
      connector.to.laneId,
    ]),
    properties: {
      nodeId: node.id,
      fromWayId: connector.from.wayId,
      fromLaneId: connector.from.laneId,
      toWayId: connector.to.wayId,
      toLaneId: connector.to.laneId,
      renderTier: 'street',
      corridorW14: Math.max(
        corridorWidthAtJunction(waysById.get(connector.from.wayId), node.coord[1]),
        corridorWidthAtJunction(waysById.get(connector.to.wayId), node.coord[1]),
      ),
      tierOpacity: 1,
    },
    geometry: { type: 'LineString', coordinates: connector.path },
  }));

  return { type: 'FeatureCollection', features };
}
