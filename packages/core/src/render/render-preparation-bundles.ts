import { serviceWayIds } from '../model/geo';
import type { Service } from '../model/system';

function slotAt(index: number): number {
  if (index === 0) return 0;
  return index % 2 === 1 ? (index + 1) / 2 : -index / 2;
}

export interface PreparedServiceBundleDraft {
  readonly servicesByWay: Map<string, Service[]>;
  readonly slots: Map<string, number>;
  readonly occupiedByWay: Map<string, Set<number>>;
}

export function createPreparedServiceBundleDraft(): PreparedServiceBundleDraft {
  return { servicesByWay: new Map(), slots: new Map(), occupiedByWay: new Map() };
}

/** Adds exactly one service. Calling this from one measured unit per service
 * prevents first publication from hiding a whole-network bundle pass. An
 * exceptionally large single service may still truthfully exceed the budget;
 * the coordinator then retains the prior scene. */
export function addPreparedServiceBundle(
  draft: PreparedServiceBundleDraft,
  service: Service,
): void {
  const wayIds = serviceWayIds(service);
  for (const wayId of wayIds) {
    const services = draft.servicesByWay.get(wayId);
    if (services) services.push(service);
    else draft.servicesByWay.set(wayId, [service]);
  }
  let slotIndex = 0;
  while (wayIds.some((wayId) => draft.occupiedByWay.get(wayId)?.has(slotAt(slotIndex)))) {
    slotIndex++;
  }
  const slot = slotAt(slotIndex);
  draft.slots.set(service.id, slot);
  for (const wayId of wayIds) {
    const occupied = draft.occupiedByWay.get(wayId) ?? new Set<number>();
    occupied.add(slot);
    draft.occupiedByWay.set(wayId, occupied);
  }
}

/** Deterministic continuity-aware allocation shared by prepared snapshots.
 * Phase 5 may replace the policy; keeping it here makes its first touch a
 * measured preparation unit rather than hidden projection work. */
export function preparedServiceBundleSlots(
  byWay: ReadonlyMap<string, readonly Service[]>,
): ReadonlyMap<string, number> {
  const wayIdsByService = new Map<string, string[]>();
  const serviceOrder: string[] = [];
  for (const [wayId, services] of byWay) {
    for (const service of services) {
      const wayIds = wayIdsByService.get(service.id);
      if (wayIds) wayIds.push(wayId);
      else {
        wayIdsByService.set(service.id, [wayId]);
        serviceOrder.push(service.id);
      }
    }
  }
  const occupiedByWay = new Map<string, Set<number>>();
  const slots = new Map<string, number>();
  for (const serviceId of serviceOrder) {
    const wayIds = wayIdsByService.get(serviceId) ?? [];
    let slotIndex = 0;
    while (wayIds.some((wayId) => occupiedByWay.get(wayId)?.has(slotAt(slotIndex)))) slotIndex++;
    const slot = slotAt(slotIndex);
    slots.set(serviceId, slot);
    for (const wayId of wayIds) {
      const occupied = occupiedByWay.get(wayId) ?? new Set<number>();
      occupied.add(slot);
      occupiedByWay.set(wayId, occupied);
    }
  }
  return slots;
}
