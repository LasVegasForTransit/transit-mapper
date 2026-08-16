import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../src/ui/app.css', import.meta.url)),
  'utf8',
);

describe('onboarding responsive layout', () => {
  it('keeps the close action at the top of the header when a title wraps', () => {
    expect(CSS).toMatch(/\.onboarding-modal \.modal-head \{[^}]*align-items: flex-start;/);
  });

  it('bounds the desktop Service inspector to the scene and gives it its own scroller', () => {
    expect(CSS).toMatch(
      /\.onboarding-service-inspector-preview \{[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto;/,
    );
    expect(CSS).toMatch(
      /\.onboarding-scene-operations \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 320px;/,
    );
  });

  it('keeps the phone sheet fixed while its body scrolls and its footer stays visible', () => {
    expect(CSS).toMatch(
      /@media \(max-width: 767px\), \(max-height: 500px\) \{[\s\S]*?\.modal\.onboarding-modal \{[\s\S]*?height: 92dvh;[\s\S]*?max-height: 92dvh;/,
    );
    expect(CSS).toMatch(
      /\.modal\.onboarding-modal \.onboarding-body \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/,
    );
    expect(CSS).toMatch(/\.modal\.onboarding-modal \.onboarding-foot \{[\s\S]*?flex: 0 0 auto;/);
  });
});
