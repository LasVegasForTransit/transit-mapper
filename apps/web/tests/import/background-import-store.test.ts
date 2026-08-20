import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it } from 'vitest';
import {
  backgroundImportBlockMessage,
  type BackgroundImportStore,
} from '../../src/import/background-import-store';

function importStore(
  systemId: string,
  options: { readOnly?: boolean; documentStatus?: 'loading' | 'ready' } = {},
): BackgroundImportStore {
  const system = createEmptySystem();
  system.id = systemId;
  const snapshot = {
    system,
    readOnly: options.readOnly ?? false,
    documentStatus: options.documentStatus ?? 'ready',
  };
  return {
    getState: () => snapshot,
    subscribe: () => () => undefined,
  };
}

describe('background import eligibility', () => {
  it('distinguishes stale targets and mutation gates from retryable snapshots', () => {
    expect(backgroundImportBlockMessage(importStore('target'), 'target', 'TriMet')).toBeNull();
    expect(backgroundImportBlockMessage(importStore('other'), 'target', 'TriMet')).toContain(
      'different system',
    );
    expect(
      backgroundImportBlockMessage(importStore('target', { readOnly: true }), 'target', 'TriMet'),
    ).toContain('TriMet import stopped because this system is read-only');
    expect(
      backgroundImportBlockMessage(
        importStore('target', { documentStatus: 'loading' }),
        'target',
        'TriMet',
      ),
    ).toContain('loading');
  });
});
