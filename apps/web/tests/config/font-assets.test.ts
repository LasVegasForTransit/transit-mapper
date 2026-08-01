import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), 'utf8');
}

describe('Public Sans browser assets', () => {
  it('uses the same licensed local font in the editor and embed', () => {
    const fontPath = resolve(WEB_ROOT, 'src/assets/public-sans-latin.woff2');
    const stylesheet = source('src/theme/font.css');
    const editorEntry = source('src/main.tsx');
    const embedEntry = source('src/embed/main.ts');
    const html = `${source('index.html')}\n${source('embed.html')}`;

    expect(existsSync(fontPath)).toBe(true);
    expect(createHash('sha256').update(readFileSync(fontPath)).digest('hex')).toBe(
      '5ed4d31c988e73b258894244f209069ebe77dc7e564861954b21198b6de90d68',
    );
    expect(stylesheet).toContain('@font-face');
    expect(stylesheet).toContain("url('../assets/public-sans-latin.woff2')");
    expect(editorEntry).toContain("import './theme/font.css'");
    expect(embedEntry).toContain("import '../theme/font.css'");
    expect(existsSync(resolve(WEB_ROOT, 'src/assets/public-sans-ofl.txt'))).toBe(true);
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
  });

  it('records the vendored font package and version', () => {
    const stylesheet = source('src/theme/font.css');

    expect(stylesheet).toContain('@fontsource-variable/public-sans@5.2.7');
  });
});
