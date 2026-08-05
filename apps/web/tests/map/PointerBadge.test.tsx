import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PointerBadge } from '../../src/map/PointerBadge';
import type { PointerIntent } from '../../src/editor/pointerIntent';

function intent(overrides: Partial<PointerIntent> = {}): PointerIntent {
  return {
    primaryOperation: 'move-point',
    cursor: 'grab',
    badge: 'move',
    allowed: true,
    anchor: 'target',
    constraint: 'none',
    ...overrides,
  };
}

function render(value: PointerIntent | null): string {
  return renderToStaticMarkup(<PointerBadge intent={value} x={100} y={200} />);
}

describe('the pointer badge', () => {
  it('draws nothing without an intent, and nothing for a plain allowed press', () => {
    expect(render(null)).toBe('');
    expect(render(intent({ badge: null }))).toBe('');
  });

  it('positions itself at the pointer and leaves the offset to the stylesheet', () => {
    // Only x/y are per-event. Where the badge sits relative to them differs by
    // pointer — below-right of a cursor, above a fingertip — and app.css owns
    // that through --badge-dx/--badge-dy, so this component never asks what
    // kind of pointer it has.
    const markup = render(intent());

    expect(markup).toContain('left:100px');
    expect(markup).toContain('top:200px');
    expect(markup).toContain('class="pointer-badge"');
    expect(markup).not.toContain('translate');
  });

  it('marks a refusal so it can be seen where no cursor can say it', () => {
    // A finger changes no cursor, so `not-allowed` communicates nothing there.
    // The badge renders for every pointer and app.css hides the bare case
    // under `@media (hover: hover)`, where the cursor already carries it.
    const markup = render(intent({ badge: null, allowed: false }));

    expect(markup).toContain('data-pointer-refused="true"');
    expect(markup).not.toContain('data-badge');
  });

  it('keeps a badged refusal distinguishable from a bare one', () => {
    // Both are refusals, but only the bare one is hidden on a hover device —
    // so the two must not render identically.
    const markup = render(intent({ badge: 'erase', allowed: false }));

    expect(markup).toContain('data-pointer-refused="true"');
    expect(markup).toContain('data-badge="erase"');
  });

  it('carries the anchor the renderer keys its target cue off', () => {
    expect(render(intent({ anchor: 'preview' }))).toContain('data-pointer-anchor="preview"');
  });
});
