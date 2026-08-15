/**
 * A Network bundle has one order per corridor. The document's service order
 * wins when it exists, so a user does not see colours trade places after an
 * unrelated projection. Service ids break ties for imported or incomplete
 * documents that have no such order.
 */
export interface ServiceBundleOrderingOptions {
  readonly serviceOrder?: readonly string[];
}

/** The renderer asks for the local position because a service can join or
 * leave a bundle. A global service slot cannot represent that change. */
export interface ServiceBundleOrdering {
  serviceIdsOn(wayId: string): readonly string[];
  slotFor(serviceId: string, wayId: string): number;
}

export interface ServiceBundleMember {
  readonly id: string;
}

/**
 * Resolves every corridor independently while using one canonical service
 * order throughout the network. Shared services therefore retain their order
 * at joins and splits. The slots are centered around zero, so both a solo line
 * and an even-width bundle stay visually centered on their corridor.
 */
export function orderServiceBundles(
  serviceIdsByWay: ReadonlyMap<string, readonly string[]>,
  options: ServiceBundleOrderingOptions = {},
): ServiceBundleOrdering {
  const rankByServiceId = ranksFor(serviceIdsByWay, options.serviceOrder ?? []);
  const servicesByWay = new Map<string, readonly string[]>();
  const slotsByWay = new Map<string, ReadonlyMap<string, number>>();

  for (const [wayId, serviceIds] of serviceIdsByWay) {
    const ordered = [...new Set(serviceIds)].sort((left, right) => {
      const leftRank = rankByServiceId.get(left) ?? Number.POSITIVE_INFINITY;
      const rightRank = rankByServiceId.get(right) ?? Number.POSITIVE_INFINITY;
      return leftRank - rightRank || left.localeCompare(right);
    });
    const slots = new Map<string, number>();
    const center = (ordered.length - 1) / 2;
    for (const [index, serviceId] of ordered.entries()) slots.set(serviceId, index - center);
    servicesByWay.set(wayId, ordered);
    slotsByWay.set(wayId, slots);
  }

  return {
    serviceIdsOn: (wayId) => servicesByWay.get(wayId) ?? [],
    slotFor: (serviceId, wayId) => slotsByWay.get(wayId)?.get(serviceId) ?? 0,
  };
}

/** Adapts the renderer's service index without making the ordering policy
 * depend on the Service model. The policy only needs stable identities. */
export function orderServiceBundleMembers(
  membersByWay: ReadonlyMap<string, readonly ServiceBundleMember[]>,
  serviceOrder: readonly string[],
): ServiceBundleOrdering {
  const idsByWay = new Map<string, readonly string[]>();
  for (const [wayId, members] of membersByWay) {
    idsByWay.set(
      wayId,
      members.map((member) => member.id),
    );
  }
  return orderServiceBundles(idsByWay, { serviceOrder });
}

function ranksFor(
  serviceIdsByWay: ReadonlyMap<string, readonly string[]>,
  preferredOrder: readonly string[],
): ReadonlyMap<string, number> {
  const known = new Set<string>();
  for (const serviceIds of serviceIdsByWay.values()) {
    for (const serviceId of serviceIds) known.add(serviceId);
  }
  const ordered = [...preferredOrder.filter((serviceId) => known.has(serviceId))];
  const seen = new Set(ordered);
  for (const serviceId of [...known].sort()) {
    if (!seen.has(serviceId)) ordered.push(serviceId);
  }
  return new Map(ordered.map((serviceId, index) => [serviceId, index]));
}
