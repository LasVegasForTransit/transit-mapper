import { describe, expect, it } from 'vitest';
import {
  ROUTE_INSPECTOR_COPY,
  segmentCountLabel,
} from '../../../src/ui/inspector/ServiceInspector';

describe('Service inspector vocabulary', () => {
  it('describes the technical Service and its path without treating corridors as objects', () => {
    expect(ROUTE_INSPECTOR_COPY.pathShape).toBe('Path shape');
    expect(ROUTE_INSPECTOR_COPY.moveService).toContain('public Line');
    expect(ROUTE_INSPECTOR_COPY.adoptHelp).not.toMatch(/\b(pattern|corridor|way)\b/i);
    expect(ROUTE_INSPECTOR_COPY.pathHelp).not.toMatch(/\b(pattern|corridor|way)\b/i);
    expect(segmentCountLabel(1)).toBe('1 segment');
    expect(segmentCountLabel(2)).toBe('2 segments');
  });
});
