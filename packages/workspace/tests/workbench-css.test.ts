import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOLBAR_FITS } from '../src/index';

const stylesheetUrl = new URL('../src/workbench.css', import.meta.url);
const CSS = existsSync(stylesheetUrl) ? readFileSync(fileURLToPath(stylesheetUrl), 'utf8') : '';

const stepsInCss = new Set(
  [...CSS.matchAll(/\.actions-full\[data-fit='([a-z]+)'\]/g)].map((match) => match[1]),
);

describe('Workbench stylesheet ownership', () => {
  it('owns the responsive surfaces that the component mounts', () => {
    for (const selector of [
      '.compact-top-bar',
      '.compact-workbench',
      '.top-app-bar',
      '.dock-slot',
      '.zen-restore',
    ]) {
      expect(CSS, `missing ${selector}`).toContain(selector);
    }
  });

  it('styles every toolbar fit below the full rendering', () => {
    expect(stepsInCss.has('full')).toBe(false);
    for (const fit of TOOLBAR_FITS.slice(1)) expect(stepsInCss).toContain(fit);
  });

  it('reveals overflow whenever a fit hides an action', () => {
    for (const fit of TOOLBAR_FITS) {
      const hidesAction =
        CSS.includes(`.actions-full[data-fit='${fit}'] .act-tertiary`) ||
        CSS.includes(`.actions-full[data-fit='${fit}'] .act-secondary`);
      if (hidesAction) {
        expect(CSS).toContain(`.actions-full[data-fit='${fit}'] .act-overflow`);
      }
    }
  });
});
