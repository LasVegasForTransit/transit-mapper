import { serviceWayIds } from '../model/geo';
import type { Service } from '../model/system';
import { orderServiceBundleMembers, type ServiceBundleOrdering } from './service-bundle-ordering';

export interface PreparedServiceBundleDraft {
  readonly servicesByWay: Map<string, Service[]>;
  readonly serviceOrder: string[];
}

export function createPreparedServiceBundleDraft(): PreparedServiceBundleDraft {
  return { servicesByWay: new Map(), serviceOrder: [] };
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
  draft.serviceOrder.push(service.id);
}

/** Resolves positions once all services have joined the preparation draft.
 * Incremental source projection reads this immutable result instead of
 * re-running Network cartography for every visible corridor. */
export function preparedServiceBundleOrdering(
  draft: PreparedServiceBundleDraft,
): ServiceBundleOrdering {
  return orderServiceBundleMembers(draft.servicesByWay, draft.serviceOrder);
}
