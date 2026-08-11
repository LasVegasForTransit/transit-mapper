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
    expect(backgroundImportBlockMessage(importStore('target'), 'target')).toBeNull();
    expect(backgroundImportBlockMessage(importStore('other'), 'target')).toContain(
      'different system',
    );
    expect(
      backgroundImportBlockMessage(importStore('target', { readOnly: true }), 'target'),
    ).toContain('read-only');
    expect(
      backgroundImportBlockMessage(importStore('target', { documentStatus: 'loading' }), 'target'),
    ).toContain('loading');
  });
});
