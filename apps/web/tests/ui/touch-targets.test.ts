import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A finger is about 24 CSS px across and the platforms ask for a 44px target
 * around it. Before this rule existed, thirty-odd controls were under that —
 * the tool dock's buttons at 36x36 and its variant carets at 16x36, the
 * action icons at 34x34, menu rows at 37px, the colour swatches at 27x27, and
 * every raw checkbox at 13x13.
 *
 * The rules that fix it cannot be observed from a test renderer — jsdom has
 * no layout, and the browser pane cannot report a coarse pointer — so this
 * reads the stylesheet instead. It is a weaker check than measuring, and it
 * is the strongest one available without a real device: it proves the floor
 * is declared for every control named here, which is what silently regresses.
 *
 * Add a control to TOUCH_TARGETS when you add one to the chrome. The list is
 * the point; a rule with nothing asserting it is how the last set drifted.
 */
const CSS = readFileSync(fileURLToPath(new URL('../../src/ui/app.css', import.meta.url)), 'utf8');

/** The smallest a control may be under a finger. */
const FLOOR = 44;

/**
 * Every block for one media feature, joined.
 *
 * All of them, not the first: `(hover: none)` is declared twice on purpose —
 * once high in the file for the pointer badge, once low for the actions that
 * only hover was revealing — and a helper that stopped at the first would
 * assert against the wrong one and pass for the wrong reason.
 */
function block(feature: string): string {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = CSS.indexOf(`@media (${feature})`, from);
    if (start < 0) break;
    // Brace-match rather than regex: these blocks contain nested rules.
    let depth = 0;
    let end = CSS.length;
    for (let i = CSS.indexOf('{', start); i < CSS.length; i += 1) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    found.push(CSS.slice(start, end));
    from = end;
  }
  return found.join('\n');
}

const coarse = block('pointer: coarse');
const hoverless = block('hover: none');

/** Every selector that must carry a 44px floor when the pointer is a finger. */
const TOUCH_TARGETS = [
  '.tool-btn',
  '.tool-btn-caret',
  '.btn',
  '.ghost-btn',
  '.primary-btn',
  '.icon-btn',
  '.mobile-more-btn',
  '.view-switch-btn',
  '.sim-speed-trigger',
  '.dropdown-menu-item',
  '.lp-row',
  '.list-row',
  '.svc-chip',
  '.insp-tab',
  '.seg',
  '.chip-remove-btn',
  '.sidebar-disclosure',
];

describe('touch targets', () => {
  it('declares a coarse-pointer block at all', () => {
    expect(coarse, 'no @media (pointer: coarse) block in app.css').not.toBe('');
  });

  it.each(TOUCH_TARGETS)('gives %s a 44px floor under a finger', (selector) => {
    // The selector may sit in a grouped rule, so look for it and then for a
    // floor anywhere in the declaration block that follows it.
    const at = coarse.indexOf(`${selector},`) >= 0 ? `${selector},` : `${selector} {`;
    const index = coarse.indexOf(at);
    expect(index, `${selector} is not in the coarse-pointer block`).toBeGreaterThanOrEqual(0);

    const rule = coarse.slice(index, coarse.indexOf('}', index));
    const sizes = [
      ...rule.matchAll(/(?:min-height|min-width|height|width|padding):[^;]*?(\d+)px/g),
    ];
    expect(sizes.length, `${selector} has no size declaration`).toBeGreaterThan(0);
    const largest = Math.max(...sizes.map((match) => Number(match[1])));
    expect(largest, `${selector} tops out at ${largest}px`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('keys the floor to the pointer, not the viewport width', () => {
    // A touchscreen laptop is 1440px wide and still driven by a finger; a
    // narrow window with a mouse is not. device/capabilities.ts exists to keep
    // these apart, and this rule has to respect that too.
    expect(coarse).not.toContain('max-width');
  });

  it('reveals the hover-only stop actions when there is no hover', () => {
    // Skip returning / Start here / End here / Split were opacity:0 behind a
    // :hover reveal, so on a phone they did not exist.
    expect(hoverless, 'no @media (hover: none) block in app.css').not.toBe('');
    expect(hoverless).toContain('.stop-actions');
    expect(hoverless).toMatch(/\.stop-actions\s*\{[^}]*opacity:\s*1/);
  });

  it('asks about hover separately from pointer precision', () => {
    // Keying the reveal to `coarse` would take these actions away from a
    // touchscreen laptop's mouse, which is exactly the conflation the
    // capability module was written to prevent.
    expect(hoverless).not.toContain('pointer:');
  });
});
