import { describe, expect, it } from 'vitest';
import {
  appleIconProvenanceMatches,
  createAppleIconProvenance,
  type AppleIconProvenanceInputs,
} from '../../scripts/apple-icon-provenance';

const encoder = new TextEncoder();

function inputs(overrides: Partial<AppleIconProvenanceInputs> = {}): AppleIconProvenanceInputs {
  return {
    iconDocument: encoder.encode('icon document'),
    layer: encoder.encode('route layer'),
    exportImage: encoder.encode('Icon Composer export'),
    ...overrides,
  };
}

describe('Apple icon provenance', () => {
  it.each([
    ['Icon Composer document', { iconDocument: encoder.encode('changed document') }],
    ['generated Route layer', { layer: encoder.encode('changed layer') }],
    ['Icon Composer export', { exportImage: encoder.encode('changed export') }],
  ])('changing the %s invalidates the recorded export', (_name, override) => {
    const original = inputs();
    const provenance = createAppleIconProvenance(original);

    expect(appleIconProvenanceMatches(provenance, inputs(override))).toBe(false);
  });
});
