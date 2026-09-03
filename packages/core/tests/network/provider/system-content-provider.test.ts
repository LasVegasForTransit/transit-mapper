import { describe, expect, it } from 'vitest';
import { createSystemContentProvider } from '../../../src/network/system-content-provider';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function migratableSystem() {
  const way = aRoad('fallback-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  return aSystem({
    ways: [way],
    stops: [aStop('fallback-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
    services: [aService('fallback-plan', [aPattern('fallback-pattern', [way], [way.id])])],
  });
}

/** A headway v16 stores happily and v17 refuses. This is what makes the
 * fallback reachable: an orphaned Service fails both providers, so falling
 * back with one would help nobody. */
function unmigratableSystem() {
  const base = migratableSystem();
  return {
    ...base,
    services: base.services.map((service) => ({ ...service, frequencyMinutes: 0 })),
  };
}

describe('system content provider selection', () => {
  it('serves a migratable document with the v17 provider', async () => {
    const system = migratableSystem();
    const selected = createSystemContentProvider(system);

    expect(selected.schema).toBe(17);
    expect(selected.issues).toHaveLength(0);
    const descriptor = await selected.provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    expect(descriptor.content.kind).toBe('transit-system');
  });

  it('serves a document v17 refuses with the v16 provider rather than refusing it', async () => {
    const system = unmigratableSystem();
    const selected = createSystemContentProvider(system);

    expect(selected.schema).toBe(16);
    const descriptor = await selected.provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    expect(descriptor.content.kind).toBe('transit-system');
  });

  it('reports why v17 was declined rather than falling back silently', () => {
    const selected = createSystemContentProvider(unmigratableSystem());

    expect(selected.issues.map((issue) => issue.code)).toContain('invalid-legacy-headway');
  });
});
