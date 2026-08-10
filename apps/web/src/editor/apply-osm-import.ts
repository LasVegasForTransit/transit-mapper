import { withComponent } from '@transitmapper/core/model/components';
import { withoutAlreadyImported, type ImportedNetwork } from '@transitmapper/core/model/import';
import type { TransitSystem } from '@transitmapper/core/model/system';

export interface AppliedOsmImport {
  system: TransitSystem;
  addedWayIds: string[];
  skipped: number;
}

/** Pure seam-aware append shared by foreground and background store actions. */
export function applyOsmImportToSystem(
  system: TransitSystem,
  incoming: ImportedNetwork,
): AppliedOsmImport {
  const { network, duplicateWays, identityAdditions, junctionAdditions } = withoutAlreadyImported(
    incoming,
    system.ways,
    system.namedWays,
    system.nodes,
  );
  const identityMembers = new Map(identityAdditions.map((entry) => [entry.id, entry.wayIds]));
  const junctionArms = new Map(junctionAdditions.map((entry) => [entry.id, entry.refs]));
  return {
    system: {
      ...system,
      ways: [...system.ways, ...network.ways],
      nodes: [
        // A seam junction gains only the missing arms instead of creating a
        // rival Node at the same coordinate.
        ...system.nodes.map((node) => {
          const additions = junctionArms.get(node.id);
          return additions ? { ...node, refs: [...node.refs, ...additions] } : node;
        }),
        ...network.nodes,
      ],
      namedWays: [
        // A named street crossing a tile boundary stays one shared identity.
        ...system.namedWays.map((namedWay) => {
          const additions = identityMembers.get(namedWay.id);
          return additions ? { ...namedWay, wayIds: [...namedWay.wayIds, ...additions] } : namedWay;
        }),
        ...network.namedWays,
      ],
      // Replace components by key so a later seam batch can complete a
      // carriageway pair without duplicating its median or restriction.
      medians: network.medians.reduce(
        (components, entry) => withComponent(components, entry.id, entry.median),
        system.medians,
      ),
      turnRestrictions: network.turnRestrictions.reduce(
        (components, entry) => withComponent(components, entry.key, entry.restriction),
        system.turnRestrictions,
      ),
    },
    addedWayIds: network.ways.map((way) => way.id),
    skipped: duplicateWays,
  };
}
