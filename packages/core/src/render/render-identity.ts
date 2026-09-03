import { transitEntityKey, type TransitEntityRef } from '../model/transit-entity-ref';

declare const systemFeatureSourceIdBrand: unique symbol;
declare const renderFeatureIdBrand: unique symbol;
declare const renderDomainIdentityBrand: unique symbol;

/** A renderer-owned source key, independent of any MapLibre source name. */
export type SystemFeatureSourceId = string & {
  readonly [systemFeatureSourceIdBrand]: 'SystemFeatureSourceId';
};

/** A unique top-level GeoJSON feature identity used for differential updates. */
export type RenderFeatureId = string & {
  readonly [renderFeatureIdBrand]: 'RenderFeatureId';
};

/** A semantic model identity used to address every visual fragment it owns. */
export type RenderDomainIdentity = string & {
  readonly [renderDomainIdentityBrand]: 'RenderDomainIdentity';
};

export type RenderIdentityPart = string | number;

export interface RenderIdentityBinding {
  domainIdentity: RenderDomainIdentity;
  renderFeatureIds: readonly RenderFeatureId[];
}

export interface RenderIdentityIndex {
  renderFeatureIdsByDomain: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
}

function requireText(value: string, label: string): string {
  if (value.length === 0 || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value;
}

function encoded(value: RenderIdentityPart): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Render identity numbers must be finite.');
    return encodeURIComponent(String(value));
  }
  return encodeURIComponent(requireText(value, 'Render identity component'));
}

export function systemFeatureSourceId(value: string): SystemFeatureSourceId {
  return requireText(value, 'System feature source ID') as SystemFeatureSourceId;
}

/** Creates a stable role-qualified identity from semantic, never geometric, inputs.
 *
 * Encoding each component prevents IDs such as `['a:b', 'c']` and
 * `['a', 'b:c']` from collapsing to the same string. Callers remain
 * responsible for choosing model IDs rather than emission indexes whenever
 * the model supplies an identity. */
export function renderFeatureId(
  sourceId: SystemFeatureSourceId,
  role: string,
  identity: readonly RenderIdentityPart[],
): RenderFeatureId {
  requireText(sourceId, 'System feature source ID');
  requireText(role, 'Render feature role');
  if (identity.length === 0) throw new Error('Render feature identity must not be empty.');
  return `render:${encoded(sourceId)}:${encoded(role)}:${identity.map(encoded).join(':')}` as RenderFeatureId;
}

export function renderDomainIdentity(reference: TransitEntityRef): RenderDomainIdentity;
export function renderDomainIdentity(kind: string, id: string): RenderDomainIdentity;
export function renderDomainIdentity(
  referenceOrKind: TransitEntityRef | string,
  id?: string,
): RenderDomainIdentity {
  if (typeof referenceOrKind !== 'string') {
    // Both brands use the legacy domain bytes, but neither layer owns the other's type.
    return transitEntityKey(referenceOrKind) as unknown as RenderDomainIdentity;
  }

  requireText(referenceOrKind, 'Render domain kind');
  requireText(id ?? '', 'Render domain ID');
  return `domain:${encoded(referenceOrKind)}:${encoded(id ?? '')}` as RenderDomainIdentity;
}

/** Builds deterministic many-to-many domain grouping for batched visual features.
 *
 * A single shared-run feature can belong to several services. The index groups
 * each service with that render ID without forcing visual geometry to be split
 * into one duplicate feature per domain entity. */
export function createRenderIdentityIndex(
  bindings: readonly RenderIdentityBinding[],
): RenderIdentityIndex {
  const idsByDomain = new Map<RenderDomainIdentity, Set<RenderFeatureId>>();
  for (const binding of bindings) {
    requireText(binding.domainIdentity, 'Render domain identity');
    let ids = idsByDomain.get(binding.domainIdentity);
    if (!ids) {
      ids = new Set<RenderFeatureId>();
      idsByDomain.set(binding.domainIdentity, ids);
    }
    for (const id of binding.renderFeatureIds) {
      requireText(id, 'Render feature ID');
      ids.add(id);
    }
  }

  const renderFeatureIdsByDomain = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();
  const orderedDomains = [...idsByDomain.keys()].sort();
  for (const domainIdentity of orderedDomains) {
    const renderFeatureIds = idsByDomain.get(domainIdentity);
    if (renderFeatureIds) {
      renderFeatureIdsByDomain.set(domainIdentity, [...renderFeatureIds].sort());
    }
  }
  return { renderFeatureIdsByDomain };
}

export function emptyRenderIdentityIndex(): RenderIdentityIndex {
  return { renderFeatureIdsByDomain: new Map() };
}
