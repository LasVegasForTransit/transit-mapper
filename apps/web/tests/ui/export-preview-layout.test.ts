import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('../../src/ui/app.css', import.meta.url)), 'utf8');

describe('export preview layout', () => {
  it('keeps a drawable map area in the compact single-column dialog', () => {
    const compactEnd = CSS.indexOf('@keyframes sheet-in');
    const compactStart = CSS.lastIndexOf(
      '@media (max-width: 767px), (max-height: 500px) {',
      compactEnd,
    );
    expect(compactStart).toBeGreaterThan(-1);
    const compactLayout = CSS.slice(compactStart, compactEnd);

    expect(compactLayout).toMatch(
      /\.export-preview-wrap\s*{[^}]*flex:\s*none;[^}]*min-height:\s*min\(52vw,\s*240px\);[^}]*}/s,
    );
  });
});
