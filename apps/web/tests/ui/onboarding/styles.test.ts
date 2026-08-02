import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../../..');
const appCss = readFileSync(resolve(WEB_ROOT, 'src/ui/app.css'), 'utf8');
const tokensCss = readFileSync(resolve(WEB_ROOT, 'src/theme/tokens.css'), 'utf8');
const onboardingCss = appCss.slice(
  appCss.indexOf('/* ---- onboarding dialog ---- */'),
  appCss.indexOf('.insp-field'),
);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return onboardingCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe('onboarding styles', () => {
  it('uses theme roles that exist', () => {
    const usedRoles = [...onboardingCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    const definedRoles = new Set(
      [...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    );

    expect([...new Set(usedRoles)].filter((role) => !definedRoles.has(role))).toEqual([]);
  });

  it('keeps progress tabs large enough to tap', () => {
    const rule = ruleFor('.onboarding-dot');
    const width = Number(rule.match(/width:\s*(\d+)px/)?.[1]);
    const height = Number(rule.match(/height:\s*(\d+)px/)?.[1]);

    expect(width).toBeGreaterThanOrEqual(24);
    expect(height).toBeGreaterThanOrEqual(24);
  });
});
