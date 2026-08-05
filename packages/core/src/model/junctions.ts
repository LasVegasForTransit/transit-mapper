// What a junction is allowed to be, and how a document that says otherwise is
// brought back in line. Geometry lives in geometry/junctions.ts; this file is
// only about which arms may share a Node at all.

import { wayType } from './catalog';
import type { Node, Way, WayPointRef } from './system';

/** Way type per way id — what both callers of withSingleTypeArms already have
 *  to hand, and all it needs. */
export type WayTypeIndex = Map<string, string>;

/** A way-type index over `ways`. */
export function wayTypeIndex(ways: Way[]): WayTypeIndex {
  return new Map(ways.map((w) => [w.id, w.typeId]));
}

/**
 * The set a way type may share a junction with: its catalog junction group,
 * or the type itself when it has none (see WayType.junctionGroupId).
 *
 * Deliberately looser than the rule for FORMING a junction, which needs an
 * exact typeId match. Forming one is a guess about what somebody meant by
 * drawing two lines across each other, and a wrong guess is easy to make and
 * annoying to undo. Keeping one is a judgement about a junction that already
 * exists — usually because OSM says a surveyor found it there — and getting
 * that wrong deletes real connectivity nobody asked us to touch. Different
 * risks, different bars.
 */
export function junctionGroupOf(typeId: string): string {
  return wayType(typeId).junctionGroupId ?? typeId;
}

/** The distinct way types meeting at one junction, in ref order. Two of them
 *  in different junction groups is the fault findMismatchedTypeJunctions
 *  reports. */
export function junctionTypeIds(node: Node, waysById: Map<string, Way>): string[] {
  return [
    ...new Set(
      node.refs
        .map((ref) => waysById.get(ref.wayId)?.typeId)
        .filter((typeId): typeId is string => typeId !== undefined),
    ),
  ];
}

/**
 * `nodes` with every junction cut down to arms of ONE junction group, and any
 * junction left with fewer than two arms dropped.
 *
 * A Node carries a lane graph, and the lanes of a road do not continue into
 * the lanes of a track, so a junction spanning both describes a connection no
 * vehicle can make: the road-and-rail junction the editor used to build by
 * itself. Two producers of those are still out there, and both run this — a
 * document saved before the rule existed (including a pre-node document,
 * whose junctions serialize.ts derives from bare coordinate coincidence, so a
 * tram running down a street becomes a junction with it), and an OSM import,
 * where a street-running tram genuinely shares node ids with its road.
 *
 * A bike path meeting a road is NOT one of these, which is why the grouping
 * is junctionGroupOf and not raw typeId — see that function for why keeping a
 * junction and forming one are held to different standards.
 *
 * The arms that stay are the largest compatible group, so a four-way street
 * junction with one tram arm keeps being a four-way street junction. Ties go
 * to the group whose first arm appears first, which makes the repair
 * deterministic rather than dependent on Map iteration order.
 *
 * The tempting alternative — keep every group, as one Node each — is the one
 * to avoid. Two Nodes at one coordinate is not cosmetic: cascadeMove finds
 * only the first, so dragging the junction moves one Node's arms and strands
 * the other's, and setNodeControl reaches only one of them. Losing the
 * minority group's junction is the lesser fault, and it is a fault nobody can
 * see, since those ways still meet at the same point.
 *
 * Nothing MOVES. The interactive disconnect nudges the departing way 12 m
 * clear so the person can see what they just did; this runs on load and on
 * import, where silently shifting geometry someone drew would be a worse
 * answer than leaving two corridors crossing at one coordinate — which is
 * what a level crossing looks like today anyway.
 */
export function withSingleTypeArms(nodes: Node[], typeByWayId: WayTypeIndex): Node[] {
  const repaired: Node[] = [];
  for (const node of nodes) {
    const kept = largestCompatibleGroup(node.refs, typeByWayId);
    if (kept.length < 2) continue;
    if (kept.length === node.refs.length) {
      repaired.push(node);
      continue;
    }
    const keptWayIds = new Set(kept.map((ref) => ref.wayId));
    const connectors = node.connectors?.filter(
      (c) => keptWayIds.has(c.from.wayId) && keptWayIds.has(c.to.wayId),
    );
    const next: Node = { ...node, refs: kept };
    // A connector naming an arm that just left would break junctionGeometry,
    // which resolves every connector endpoint against a live arm.
    if (connectors && connectors.length > 0) next.connectors = connectors;
    else delete next.connectors;
    repaired.push(next);
  }
  return repaired;
}

function largestCompatibleGroup(refs: WayPointRef[], typeByWayId: WayTypeIndex): WayPointRef[] {
  const groups = new Map<string, WayPointRef[]>();
  for (const ref of refs) {
    const typeId = typeByWayId.get(ref.wayId);
    if (typeId === undefined) continue; // the way is gone; the arm goes with it
    const group = groups.get(junctionGroupOf(typeId));
    if (group) group.push(ref);
    else groups.set(junctionGroupOf(typeId), [ref]);
  }
  let best: WayPointRef[] = [];
  for (const group of groups.values()) if (group.length > best.length) best = group;
  return best;
}
