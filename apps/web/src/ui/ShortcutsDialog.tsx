import { useMemo } from 'react';
import { KEY_BINDINGS } from '../editor/keymap';
import { Modal } from './Modal';
const KEY_LABEL: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: '↵',
  Delete: 'Del',
  Backspace: '⌫',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ' ': 'Space',
};

function keyLabel(k: string): string {
  return KEY_LABEL[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  // Group bindings by their declared group, preserving first-seen order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof KEY_BINDINGS>();
    for (const b of KEY_BINDINGS) {
      if (!byGroup.has(b.group)) {
        byGroup.set(b.group, []);
        order.push(b.group);
      }
      byGroup.get(b.group)!.push(b);
    }
    return order.map((name) => ({ name, bindings: byGroup.get(name)! }));
  }, []);

  return (
    <Modal
      title="Keyboard shortcuts"
      description="Every keyboard shortcut available in the editor, grouped by category."
      onClose={onClose}
      className="shortcuts-modal"
    >
      <div className="shortcuts-grid">
        {groups.map((g) => (
          <section key={g.name} className="shortcuts-group">
            <h3 className="shortcuts-group-title">{g.name}</h3>
            {g.bindings.map((b, i) => (
              // index, not b.description — two distinct bindings can share a
              // description (Ctrl+Shift+Z and Ctrl+Y are both "Redo"), and
              // KEY_BINDINGS is a static constant that never reorders, so an
              // index key is safe here and simpler than fabricating a
              // composite one.
              <div className="shortcut-row" key={i}>
                <span className="shortcut-desc">{b.description}</span>
                <span className="shortcut-keys">
                  {b.mod && <kbd>{MOD_LABEL}</kbd>}
                  {b.shift && <kbd>Shift</kbd>}
                  {b.keys.map((k) => (
                    <kbd key={k}>{keyLabel(k)}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* Every gesture below already worked — map/touch-gestures.ts has
          implemented all four since it was written. Nothing in the interface
          said so: a grep for "long press", "double tap", "two finger" or
          "pinch" across the app returned four hits, all of them code
          comments and none of them on screen. The only in-app help was this
          dialog, listing keys a phone does not have.

          So this is documentation of what exists, not a new capability, and
          it is here rather than in a touch-only surface because the two
          columns explain each other — "long press" IS right-click, and
          knowing that is what makes the rest of the list usable by finger. */}
      <section className="shortcuts-group shortcuts-touch">
        <h3 className="shortcuts-group-title">By finger</h3>
        <div className="shortcut-row">
          <span className="shortcut-desc">Use the current tool</span>
          <span className="shortcut-keys">drag one finger</span>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-desc">Pan the map</span>
          <span className="shortcut-keys">drag two fingers</span>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-desc">Zoom</span>
          <span className="shortcut-keys">pinch</span>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-desc">Finish the line you are drawing</span>
          <span className="shortcut-keys">double-tap</span>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-desc">Open the actions menu (right-click)</span>
          <span className="shortcut-keys">long press</span>
        </div>
      </section>

      <p className="shortcuts-foot">
        Pan also works by right-drag or <kbd>Space</kbd>-drag · Alt-click deletes a point or stop ·
        Shift constrains to 45°. Erase and Split are on the Select tool&rsquo;s own menu, which is
        how a finger reaches them.
      </p>
    </Modal>
  );
}
