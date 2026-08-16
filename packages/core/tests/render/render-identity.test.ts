import type { Feature, LineString, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  createRenderIdentityIndex,
  renderDomainIdentity,
  renderFeatureId,
  systemFeatureSourceId,
} from '../../src/render/render-identity';

describe('render identity', () => {
  it('creates stable role-qualified IDs without delimiter collisions', () => {
    const sourceId = systemFeatureSourceId('services');

    expect(renderFeatureId(sourceId, 'line', ['service:a', 'outbound'])).toBe(
      renderFeatureId(sourceId, 'line', ['service:a', 'outbound']),
    );
    expect(renderFeatureId(sourceId, 'line', ['service:a', 'outbound'])).not.toBe(
      renderFeatureId(sourceId, 'line', ['service', 'a:outbound']),
    );
    expect(renderFeatureId(sourceId, 'line', ['service:a', 'outbound'])).not.toBe(
      renderFeatureId(sourceId, 'hit', ['service:a', 'outbound']),
    );
  });

  it('maps one batched visual feature to every represented domain identity', () => {
    const sourceId = systemFeatureSourceId('services');
    const sharedVisualId = renderFeatureId(sourceId, 'shared-run', ['run-7']);
    const serviceA = renderDomainIdentity('service', 'service-a');
    const serviceB = renderDomainIdentity('service', 'service-b');

    const index = createRenderIdentityIndex([
      { domainIdentity: serviceB, renderFeatureIds: [sharedVisualId] },
      { domainIdentity: serviceA, renderFeatureIds: [sharedVisualId, sharedVisualId] },
    ]);

    expect([...index.renderFeatureIdsByDomain.keys()]).toEqual([serviceA, serviceB]);
    expect(index.renderFeatureIdsByDomain.get(serviceA)).toEqual([sharedVisualId]);
    expect(index.renderFeatureIdsByDomain.get(serviceB)).toEqual([sharedVisualId]);
  });

  it('rejects empty source, role, domain kind, and domain ID components', () => {
    expect(() => systemFeatureSourceId('')).toThrow(/source ID/i);
    expect(() => renderFeatureId(systemFeatureSourceId('ways'), '', ['way-a'])).toThrow(/role/i);
    expect(() => renderFeatureId(systemFeatureSourceId('ways'), 'line', [])).toThrow(/identity/i);
    expect(() => renderFeatureId(systemFeatureSourceId('ways'), 'line', [''])).toThrow(/identity/i);
    expect(() => renderDomainIdentity('', 'way-a')).toThrow(/kind/i);
    expect(() => renderDomainIdentity('way', '')).toThrow(/domain ID/i);
  });

  it('keeps visual and hit feature identities distinct', () => {
    const sourceId = systemFeatureSourceId('ways');
    const visual: Feature<LineString> = {
      type: 'Feature',
      id: renderFeatureId(sourceId, 'overview-silhouette', ['way-a']),
      properties: { wayId: 'way-a' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    };
    const hit: Feature<Point> = {
      type: 'Feature',
      id: renderFeatureId(sourceId, 'domain-hit', ['way-a']),
      properties: { wayId: 'way-a', hitTarget: true },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };

    expect(visual.id).not.toBe(hit.id);
  });
});
