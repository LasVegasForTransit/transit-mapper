import { describe, expect, it } from 'vitest';
import {
  ROUTE_INSPECTOR_COPY,
  segmentCountLabel,
} from '../../../src/ui/inspector/ServiceInspector';

describe('Service inspector vocabulary', () => {
  it('keeps route controls concise without treating corridors as objects', () => {
    expect(ROUTE_INSPECTOR_COPY.pathShape).toBe('Path shape');
    expect(ROUTE_INSPECTOR_COPY.adoptTitle).not.toMatch(/\b(pattern|corridor|way)\b/i);
    expect(segmentCountLabel(1)).toBe('1 segment');
    expect(segmentCountLabel(2)).toBe('2 segments');
  });
});
