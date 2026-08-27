import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { SRC_SERVICES } from '../layers/constants';
import type { ProjectionPlanningContext } from './resumable-feature-projection-planning';
import { emptySystemFeatures } from '../system-feature-sources';
import { buildFeaturesForSources } from './source-feature-projection';

/**
 * A Street service is drawn in two complementary passes. Corridor units own
 * its trimmed lane stretches; this pass owns only the short turn inside a
 * junction. Keeping the turn separate lets corridor work remain bounded
 * without leaving a visible gap where two lane-aligned stretches meet.
 */
function retainStreetServiceJunctionConnectors(
  features: SystemFeatures,
  nodeId: string,
): SystemFeatures {
  const connectorPathRole = `junction:${nodeId}`;
  const retained = emptySystemFeatures();
  retained.services.features = features.services.features.filter(
    (feature) => feature.properties?.pathRole === connectorPathRole,
  );
  return retained;
}

function serviceWayIdsForConnector(
  context: ProjectionPlanningContext,
  nodeId: string,
  visibleServiceWayIds: ReadonlySet<string>,
): readonly string[] {
  // Planning already orders an intersection's incident ways by visible-way
  // order. Preserve it here so this compact support pass uses the same
  // topology input as the corridor passes surrounding the junction.
  return (context.incidentWayIdsByJunction.get(nodeId) ?? []).filter((wayId) =>
    visibleServiceWayIds.has(wayId),
  );
}

/**
 * A connector needs both approaches to a junction at once. A normal corridor
 * unit intentionally has only its primary corridor, so it cannot construct a
 * turn safely. Build the compact connector result with the incident corridors
 * as context, then retain just the connector feature rather than duplicating
 * either long service stretch in the aggregate scene.
 */
export function appendStreetServiceJunctionConnectorUnits(
  context: ProjectionPlanningContext,
): void {
  if (context.options.view.viewMode !== 'infrastructure') return;
  if (!context.sourceIds.includes(SRC_SERVICES)) return;

  const geometryNodeIds = context.scope
    ? context.visibleJunctionIds.filter((id) =>
        context.scope?.candidates.geometryNodeIds.includes(id),
      )
    : context.visibleJunctionIds;
  const visibleServiceWayIds = new Set(
    context.scope
      ? context.visibleWayIds.filter((id) => context.scope?.candidates.serviceWayIds.includes(id))
      : context.visibleWayIds,
  );

  for (const nodeId of geometryNodeIds) {
    const incidentWayIds = serviceWayIdsForConnector(context, nodeId, visibleServiceWayIds);
    if (incidentWayIds.length < 2) continue;

    const stableWayIds = [...incidentWayIds];
    context.units.push({
      id: `service-junction-connector:${nodeId}`,
      primary: { kind: 'junction', ids: [nodeId] },
      sourceIds: [SRC_SERVICES],
      run: (counts) =>
        retainStreetServiceJunctionConnectors(
          buildFeaturesForSources({
            ...context.options,
            sourceIds: [SRC_SERVICES],
            unitScope: {
              topologyWayIds: stableWayIds,
              physicalWayIds: [],
              serviceWayIds: stableWayIds,
              geometryNodeIds: [nodeId],
              junctionOutputNodeIds: [],
              connectorOutputNodeIds: [],
              serviceIds: context.scope?.candidates.affectedServiceIds,
            },
            precomputedViewportCandidates: {
              wayIds: stableWayIds,
              wayIdSet: new Set(stableWayIds),
              junctionIds: [nodeId],
            },
            ...(counts ? { counts } : {}),
          }),
          nodeId,
        ),
    });
  }
}
