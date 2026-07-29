import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('theme surface boundaries', () => {
  it('publishes media-qualified browser chrome colors for both entrypoints', () => {
    for (const html of [read('../../index.html'), read('../../embed.html')]) {
      expect(html).toMatch(
        /name="theme-color" content="#(?:ffffff|f7f4ec)" media="\(prefers-color-scheme: light\)"/,
      );
      expect(html).toContain(
        'name="theme-color" content="#111310" media="(prefers-color-scheme: dark)"',
      );
    }
  });

  it('keeps the install manifest a static light launch fallback', () => {
    const manifest = JSON.parse(read('../../public/manifest.json')) as {
      background_color: string;
      theme_color: string;
    };

    expect(manifest.background_color).toBe('#f4f4f1');
    expect(manifest.theme_color).toBe('#191a17');
  });

  it('keeps export maps explicitly light while live auxiliary maps observe the OS', () => {
    expect(read('../../src/map/export/exportRenderer.ts')).toContain(
      "style: basemapStyleForScheme('light')",
    );
    expect(read('../../src/ui/ExportPreviewMap.tsx')).toContain(
      "style: basemapStyleForScheme('light')",
    );
    expect(read('../../src/ui/onboarding/OnboardingPreviewMap.tsx')).toContain(
      'useSystemColorScheme()',
    );
    expect(read('../../src/embed/main.ts')).toContain('subscribeSystemColorScheme(');
  });
});
