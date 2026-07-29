import { describe, expect, it } from 'vitest';
import { LAYER_SPECS } from '../../src/map/layers';
import { EMBED_LAYER_SPECS, EMBED_SOURCE_IDS } from '../../src/embed/config';

describe('embed map configuration', () => {
  it('creates only layers backed by reader-visible schematic sources', () => {
    const sourceIds = EMBED_LAYER_SPECS.map((spec) =>
      'source' in spec ? String(spec.source) : '',
    );

    expect(sourceIds.length).toBeGreaterThan(0);
    expect(sourceIds.every((source) => EMBED_SOURCE_IDS.has(source))).toBe(true);
  });

  it('prunes editor-only layers from the public embed', () => {
    expect(EMBED_LAYER_SPECS.length).toBeLessThan(LAYER_SPECS.length);
    expect(EMBED_LAYER_SPECS.some((spec) => spec.id.includes('handle'))).toBe(false);
    expect(EMBED_LAYER_SPECS.some((spec) => spec.id.includes('preview'))).toBe(false);
  });
});
