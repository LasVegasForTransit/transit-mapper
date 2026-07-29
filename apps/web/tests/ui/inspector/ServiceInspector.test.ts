import { describe, expect, it } from 'vitest';
import {
  corridorCountLabel,
  ROUTE_INSPECTOR_COPY,
} from '../../../src/ui/inspector/ServiceInspector';

describe('Route inspector vocabulary', () => {
  it('names user-facing branches without exposing the Pattern model type', () => {
    expect(ROUTE_INSPECTOR_COPY.branchesLabel).toBe('Branches');
    expect(ROUTE_INSPECTOR_COPY.branchExplanation).toContain('Each branch');
    expect(ROUTE_INSPECTOR_COPY.branchExplanation).not.toMatch(/\bpattern\b/i);
    expect(ROUTE_INSPECTOR_COPY.deleteBranch).toBe('Delete this branch');
    expect(ROUTE_INSPECTOR_COPY.corridorShape).toBe('Corridor shape');
    expect(ROUTE_INSPECTOR_COPY.mergeBranches).not.toMatch(/\bpattern\b/i);
    expect(ROUTE_INSPECTOR_COPY.adoptHelp).not.toMatch(/\b(pattern|way)\b/i);
    expect(ROUTE_INSPECTOR_COPY.corridorHelp).not.toMatch(/\b(pattern|way)\b/i);
    expect(corridorCountLabel(1)).toBe('1 corridor');
    expect(corridorCountLabel(2)).toBe('2 corridors');
  });
});
