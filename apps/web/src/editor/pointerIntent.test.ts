import { describe, expect, it } from 'vitest';
import { resolvePointerIntent, type PointerIntentInput } from './pointerIntent';

const editable = {
  readOnly: false,
  view: 'network' as const,
  tool: 'select' as const,
  armed: 'none' as const,
  gestureActive: false,
  modifiers: {},
};

interface IntentCase {
  name: string;
  input: Partial<PointerIntentInput>;
  cursor: string;
  badge: string | null;
  primaryOperation: string;
  allowed: boolean;
  anchor: 'none' | 'target' | 'preview';
  constraint: 'none' | 'constrain';
}

describe('resolvePointerIntent', () => {
  const cases: IntentCase[] = [
    {
      name: 'Any editable view / Space',
      input: { modifiers: { space: true } },
      cursor: 'grab',
      badge: null,
      primaryOperation: 'pan',
      allowed: true,
      anchor: 'none',
      constraint: 'none',
    },
    {
      name: 'Network Select / Empty',
      input: {},
      cursor: 'grab',
      badge: null,
      primaryOperation: 'pan',
      allowed: true,
      anchor: 'none',
      constraint: 'none',
    },
    {
      name: 'Network Select / Line body',
      input: { target: 'line-body' },
      cursor: 'default',
      badge: null,
      primaryOperation: 'select-line-and-branch',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Select / Station',
      input: { target: 'station' },
      cursor: 'grab',
      badge: 'move',
      primaryOperation: 'move-station',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Select / Facility',
      input: { target: 'facility' },
      cursor: 'grab',
      badge: 'move',
      primaryOperation: 'move-facility',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Select / Station Alt',
      input: { target: 'station', modifiers: { alt: true } },
      cursor: 'grab',
      badge: 'erase',
      primaryOperation: 'delete-station',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Select / Facility Alt',
      input: { target: 'facility', modifiers: { alt: true } },
      cursor: 'grab',
      badge: 'erase',
      primaryOperation: 'delete-facility',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Select / Service terminus',
      input: { target: 'service-terminus' },
      cursor: 'grab',
      badge: 'extend',
      primaryOperation: 'extend-branch',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network extending / Same branch interior',
      input: { armed: 'network-extending', target: 'same-branch-interior' },
      cursor: 'grabbing',
      badge: 'loop',
      primaryOperation: 'close-directional-loop',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network extending / Same-mode line',
      input: { armed: 'network-extending', target: 'same-mode-line' },
      cursor: 'grabbing',
      badge: 'connect',
      primaryOperation: 'connect-paths',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network extending / Different-mode line',
      input: { armed: 'network-extending', target: 'different-mode-line' },
      cursor: 'not-allowed',
      badge: null,
      primaryOperation: 'refuse',
      allowed: false,
      anchor: 'none',
      constraint: 'none',
    },
    {
      name: 'Network Line / Compatible corridor',
      input: { tool: 'way', target: 'compatible-corridor' },
      cursor: 'crosshair',
      badge: 'connect',
      primaryOperation: 'route-service',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Line / Compatible open endpoint',
      input: { tool: 'way', target: 'endpoint' },
      cursor: 'crosshair',
      badge: 'extend',
      primaryOperation: 'resume-service-and-corridor',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network Line / Empty',
      input: { tool: 'way' },
      cursor: 'crosshair',
      badge: 'new',
      primaryOperation: 'draw-service-and-corridor',
      allowed: true,
      anchor: 'preview',
      constraint: 'none',
    },
    {
      name: 'Network Line / Alt Option',
      input: { tool: 'way', modifiers: { alt: true } },
      cursor: 'crosshair',
      badge: 'separate',
      primaryOperation: 'draw-separate-corridor',
      allowed: true,
      anchor: 'preview',
      constraint: 'none',
    },
    {
      name: 'Network active route / Incompatible target',
      input: { tool: 'way', target: 'empty', routeDraftActive: true },
      cursor: 'crosshair',
      badge: null,
      primaryOperation: 'default',
      allowed: true,
      anchor: 'none',
      constraint: 'none',
    },
    {
      name: 'Network active route / Compatible open endpoint',
      input: { tool: 'way', target: 'compatible-corridor', routeDraftActive: true },
      cursor: 'crosshair',
      badge: 'connect',
      primaryOperation: 'route-service',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network active route / Compatible open endpoint Alt',
      input: {
        tool: 'way',
        target: 'compatible-corridor',
        routeDraftActive: true,
        modifiers: { alt: true },
      },
      cursor: 'crosshair',
      badge: 'connect',
      primaryOperation: 'route-service',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network armed return / Return terminus',
      input: { tool: 'way', armed: 'network-return', target: 'return-terminus' },
      cursor: 'crosshair',
      badge: 'one-way-return',
      primaryOperation: 'draw-inbound-side',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network / Right-click line',
      input: { target: 'line', modifiers: { rightButton: true } },
      cursor: 'default',
      badge: null,
      primaryOperation: 'open-line-actions',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Network / Right-click terminus',
      input: { target: 'terminus', modifiers: { rightButton: true } },
      cursor: 'default',
      badge: null,
      primaryOperation: 'open-terminus-actions',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure Select / Control point',
      input: { view: 'infrastructure', target: 'control-point' },
      cursor: 'grab',
      badge: 'move',
      primaryOperation: 'move-point',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure Select / Control point Shift',
      input: { view: 'infrastructure', target: 'control-point', modifiers: { shift: true } },
      cursor: 'grab',
      badge: 'constrain',
      primaryOperation: 'constrained-move',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure Select / Control point Alt Option',
      input: { view: 'infrastructure', target: 'control-point', modifiers: { alt: true } },
      cursor: 'grab',
      badge: 'erase',
      primaryOperation: 'erase-points',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure Select / Interior point Ctrl Cmd',
      input: { view: 'infrastructure', target: 'interior-point', modifiers: { ctrlOrMeta: true } },
      cursor: 'default',
      badge: 'split',
      primaryOperation: 'split-corridor',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure Select / Endpoint Ctrl Cmd',
      input: { view: 'infrastructure', target: 'endpoint', modifiers: { ctrlOrMeta: true } },
      cursor: 'grab',
      badge: 'extend',
      primaryOperation: 'extend-corridor',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Infrastructure / Right-click corridor',
      input: { view: 'infrastructure', target: 'corridor', modifiers: { rightButton: true } },
      cursor: 'default',
      badge: null,
      primaryOperation: 'open-corridor-actions',
      allowed: true,
      anchor: 'target',
      constraint: 'none',
    },
    {
      name: 'Read-only editable target',
      input: { readOnly: true, target: 'control-point' },
      cursor: 'not-allowed',
      badge: null,
      primaryOperation: 'refuse-edit',
      allowed: false,
      anchor: 'none',
      constraint: 'none',
    },
    {
      name: 'Diagram editable target',
      input: { view: 'diagram', target: 'control-point' },
      cursor: 'not-allowed',
      badge: null,
      primaryOperation: 'refuse-edit',
      allowed: false,
      anchor: 'none',
      constraint: 'none',
    },
  ];

  it.each(cases)(
    '$name',
    ({ input, cursor, badge, primaryOperation, allowed, anchor, constraint }) => {
      const intent = resolvePointerIntent({ ...editable, ...input });
      expect(intent).toEqual({ cursor, badge, primaryOperation, allowed, anchor, constraint });
    },
  );

  it('recomputes stationary hover intent when modifier keys change', () => {
    const base: PointerIntentInput = {
      ...editable,
      view: 'infrastructure',
      target: 'control-point',
    };
    expect(resolvePointerIntent(base)).toMatchObject({
      badge: 'move',
      primaryOperation: 'move-point',
    });
    expect(resolvePointerIntent({ ...base, modifiers: { shift: true } })).toMatchObject({
      badge: 'constrain',
      primaryOperation: 'constrained-move',
    });
    expect(resolvePointerIntent({ ...base, modifiers: { alt: true } })).toMatchObject({
      badge: 'erase',
      primaryOperation: 'erase-points',
    });
  });

  it('locks the primary operation after pointer-down while Shift changes only geometry', () => {
    const down = resolvePointerIntent({
      ...editable,
      view: 'infrastructure',
      target: 'control-point',
    });
    const dragged = resolvePointerIntent({
      ...editable,
      view: 'infrastructure',
      target: 'control-point',
      gestureActive: true,
      lockedPrimaryOperation: down.primaryOperation,
      modifiers: { shift: true, alt: true, ctrlOrMeta: true },
    });
    expect(dragged.primaryOperation).toBe('move-point');
    expect(dragged.constraint).toBe('constrain');
  });

  it('refuses read-only or Diagram editing even when an earlier pointer-down locked a move', () => {
    const locked: PointerIntentInput = {
      ...editable,
      view: 'infrastructure',
      target: 'control-point',
      gestureActive: true,
      lockedPrimaryOperation: 'move-point',
    };
    expect(resolvePointerIntent({ ...locked, readOnly: true })).toMatchObject({
      primaryOperation: 'refuse-edit',
      cursor: 'not-allowed',
      allowed: false,
    });
    expect(resolvePointerIntent({ ...locked, view: 'diagram' })).toMatchObject({
      primaryOperation: 'refuse-edit',
      cursor: 'not-allowed',
      allowed: false,
    });
  });
});
