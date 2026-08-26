import { DropdownMenuItem } from './DropdownMenu';
import { Icon } from './Icon';

interface SavedViewsActionProps {
  onOpen: () => void;
}

export function SavedViewsAction({ onOpen }: SavedViewsActionProps) {
  return (
    <span className="act-secondary">
      <button className="ghost-btn saved-views-action" onClick={onOpen} title="Saved views">
        <Icon name="platform" size={18} /> <span className="btn-label">Saved views</span>
      </button>
    </span>
  );
}

export function SavedViewsMenuItem({ onOpen }: SavedViewsActionProps) {
  return <DropdownMenuItem onSelect={onOpen}>Saved views…</DropdownMenuItem>;
}
