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
import type { RenderViewOptions, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { EditorState, Selection } from '../editor/store';
import { SRC_CONNECTORS, SRC_HANDLES, SRC_PHYSICAL_HANDLES } from '@transitmapper/renderer/layers';
import {
  buildFeaturesForSources,
  type SourceFeatureProjectionCounts,
} from '@transitmapper/renderer/projection';
import type { MapSystemFeatureSourceId } from '@transitmapper/renderer/layers';
import { EDITOR_SYSTEM_FEATURE_SOURCES } from '@transitmapper/renderer/layers';
import type {
  FeatureProjectionClientInput,
  PatternOverlayClientInput,
} from '@transitmapper/renderer/projection';

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
  updatePatternOverlay: boolean;
}

/** Everything needed to derive the editor's small, selection-owned sources.
 *
 * This deliberately omits committed source IDs and render-scene scope. A
 * caller selecting a feature may update handles or a terminus, but cannot
 * accidentally use this convenience path to rebuild streets or services.
 */
export interface EditorOverlayProjection {
  readonly system: TransitSystem;
  readonly selection: Selection;
  readonly handleWayIds: readonly string[];
  readonly view: RenderViewOptions;
  readonly physicalHandleStationId?: string | null;
  readonly physicalHandleGroupId?: string | null;
  readonly activePatternId?: string | null;
  readonly armedTerminus?: RenderedArmedTerminus | null;
  readonly counts?: SourceFeatureProjectionCounts;
}

/** The editor maps its transient selection to semantic overlay input here.
 * The renderer never receives a Zustand selection or a raw MapLibre object. */
export interface EditorPatternOverlayProjection {
  readonly system: TransitSystem;
  readonly selection: Selection;
  readonly activePatternId: string | null;
  readonly armedTerminus: RenderedArmedTerminus | null;
  readonly view: RenderViewOptions;
}

const EDITOR_SOURCE_SET = new Set<MapSystemFeatureSourceId>(EDITOR_SYSTEM_FEATURE_SOURCES);

/**
 * The selection layer names exactly the geometry it owns before any CPU work
 * starts. Both the browser worker and the legacy pure helper below consume
 * this one description, so a selection update cannot accidentally request a
 * settled street, service, or hit collection.
 */
export function editorOverlayWorkerInput({
  system,
  selection,
  handleWayIds,
  view,
  physicalHandleStationId = null,
  physicalHandleGroupId = null,
  activePatternId = null,
  armedTerminus = null,
}: EditorOverlayProjection): FeatureProjectionClientInput {
  return {
    system,
    selection,
    handleWayIds: [...handleWayIds],
    view,
    // Pattern termini now belong to the dedicated overlay source. Keeping
    // them out of this generic request prevents duplicate markers when a
    // person opens a path.
    sourceIds: [SRC_HANDLES, SRC_PHYSICAL_HANDLES],
    physicalHandleStationId,
    physicalHandleGroupId,
    activePatternId,
    armedTerminus,
    selectionOwnedConnectors: false,
  };
}

/** An ordinary Service selection remains an inspection state. Only an explicit
 * Path action supplies an active Pattern ID and therefore requests its exact
 * operational geometry from the worker. */
export function editorPatternOverlayWorkerInput({
  system,
  selection,
  activePatternId,
  armedTerminus,
  view,
}: EditorPatternOverlayProjection): PatternOverlayClientInput | null {
  if (selection?.kind !== 'service' || !activePatternId) return null;
  const service = system.services.find((candidate) => candidate.id === selection.id);
  if (service?.path.id !== activePatternId) return null;
  const armed =
    armedTerminus?.serviceId === service.id && armedTerminus.patternId === activePatternId
      ? {
          serviceId: armedTerminus.serviceId,
          patternId: armedTerminus.patternId,
          side: armedTerminus.side,
        }
      : null;
  return {
    system,
    serviceId: service.id,
    patternId: activePatternId,
    view,
    armedTerminus: armed,
  };
}

/** Projects only the short-lived geometry that makes the current edit
 * understandable. The accepted renderer scene owns every committed network
 * collection; keeping that boundary here prevents a future selection path
 * from silently expanding into a city-wide rebuild. */
export function projectEditorOverlays({
  system,
  selection,
  handleWayIds,
  view,
  physicalHandleStationId = null,
  physicalHandleGroupId = null,
  activePatternId = null,
  armedTerminus = null,
  counts,
}: EditorOverlayProjection): SystemFeatures {
  return buildFeaturesForSources({
    ...editorOverlayWorkerInput({
      system,
      selection,
      handleWayIds,
      view,
      physicalHandleStationId,
      physicalHandleGroupId,
      activePatternId,
      armedTerminus,
    }),
    ...(counts ? { counts } : {}),
  });
}

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
 * projection. Handles, junction guides, and an explicitly opened Pattern are
 * lightweight editor state rather than a committed scene mutation. */
export function planSelectionRenderUpdate(
  before: SelectionRenderState,
  after: SelectionRenderState,
): SelectionRenderUpdatePlan {
  const beforeServiceId = selectedServiceId(before.selection);
  const afterServiceId = selectedServiceId(after.selection);
  const selectedServiceChanged = beforeServiceId !== afterServiceId;
  const patternOverlayChanged =
    afterServiceId !== null &&
    (before.activePatternId !== after.activePatternId ||
      armedTerminusKey(before.armedTerminus) !== armedTerminusKey(after.armedTerminus));

  return {
    updateEditorSources:
      selectionKey(before.selection) !== selectionKey(after.selection) ||
      before.activeWayId !== after.activeWayId,
    updatePatternOverlay: selectedServiceChanged || patternOverlayChanged,
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
