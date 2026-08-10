import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../src/ui/app.css', import.meta.url)),
  'utf8',
);

describe('onboarding responsive layout', () => {
  it('keeps the embedded Service panel scrollable without the compact workbench', () => {
    expect(CSS).toMatch(
      /@media \(max-width: 767px\), \(max-height: 500px\) \{[\s\S]*?\.onboarding-service-inspector-preview \{[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto;/,
    );
    expect(CSS).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.onboarding-service-inspector-preview \{[\s\S]*?max-height: none;[\s\S]*?overflow-y: visible;/,
    );
  });
});
