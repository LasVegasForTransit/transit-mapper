import type { LibraryEntry } from '../storage/browserLibrary';
import { blurOnEnter } from './formUtils';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import type { SystemPreview } from './system-previews';
import type { SystemsView } from './systems-view-preference';

interface SystemPreviewPaneProps {
  displayName: string;
  isActive: boolean;
  opening: boolean;
  preview: SystemPreview | undefined;
  onOpen: () => void;
}

function SystemPreviewPane({
  displayName,
  isActive,
  opening,
  preview,
  onOpen,
}: SystemPreviewPaneProps) {
  if (preview === undefined) {
    return (
      <div className="systems-preview">
        <div className="systems-preview-status loading">Loading preview…</div>
      </div>
    );
  }
  if (preview.status === 'unavailable') {
    return (
      <div className="systems-preview">
        <div className="systems-preview-status unavailable">Preview unavailable</div>
      </div>
    );
  }

  const image = (
    <img
      className="systems-preview-image"
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
      alt={`Map preview of ${displayName}`}
    />
  );
  return (
    <div className="systems-preview">
      {isActive ? (
        image
      ) : (
        <button
          type="button"
          className="systems-preview-open"
          aria-label={`Open map preview of ${displayName}`}
          onClick={onOpen}
          disabled={opening}
        >
          {image}
        </button>
      )}
    </div>
  );
}

interface SystemActionsProps {
  displayName: string;
  isActive: boolean;
  isConfirming: boolean;
  isOpening: boolean;
  opening: boolean;
  shared: boolean;
  onOpen: () => void;
  onRevokeShare: () => void;
  onDuplicate: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function SystemActions(props: SystemActionsProps) {
  const { displayName, isActive, isConfirming, isOpening, opening, shared } = props;
  return (
    <div className="systems-actions">
      <button
        type="button"
        className={`systems-open ${isActive ? 'current' : ''}`}
        onClick={props.onOpen}
        disabled={isActive || opening}
        aria-label={isActive ? 'Current system' : `Open ${displayName}`}
        title={isActive ? 'Current system' : 'Open'}
      >
        <Icon name={isActive ? 'check' : 'door'} size={16} />
        {isActive ? 'Current' : isOpening ? 'Opening…' : 'Open'}
      </button>
      <span className="systems-secondary-actions">
        {shared && (
          <IconButton
            icon="share"
            size={16}
            active
            label={`Shared — stop sharing ${displayName}`}
            onClick={props.onRevokeShare}
            disabled={opening}
          />
        )}
        <IconButton
          icon="copy"
          size={16}
          label={`Duplicate ${displayName}`}
          onClick={props.onDuplicate}
          disabled={opening}
        />
        {isConfirming ? (
          <span className="systems-confirm">
            <button
              type="button"
              className="danger-btn systems-confirm-btn"
              onClick={props.onConfirmDelete}
              disabled={opening}
            >
              Delete
            </button>
            <button
              type="button"
              className="ghost-btn systems-confirm-btn"
              onClick={props.onCancelDelete}
              disabled={opening}
            >
              Cancel
            </button>
          </span>
        ) : (
          <IconButton
            icon="trash"
            size={16}
            label={`Delete ${displayName}`}
            onClick={props.onRequestDelete}
            disabled={opening}
          />
        )}
      </span>
    </div>
  );
}

interface SystemLibraryEntryProps {
  currentName: string;
  entry: LibraryEntry;
  isActive: boolean;
  isConfirming: boolean;
  openingId: string | null;
  preview: SystemPreview | undefined;
  relativeUpdatedAt: string;
  shared: boolean;
  view: SystemsView;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
  onDuplicate: (entry: LibraryEntry) => void;
  onOpen: (id: string) => void;
  onRename: (entry: LibraryEntry, name: string) => void;
  onRequestDelete: (id: string) => void;
  onRevokeShare: (id: string) => void;
}

export function SystemLibraryEntry(props: SystemLibraryEntryProps) {
  const { entry, isActive, openingId } = props;
  const name = isActive ? props.currentName : entry.name;
  const displayName = name.length > 0 ? name : 'Untitled system';
  const opening = openingId !== null;
  return (
    <li className={`systems-row ${isActive ? 'active' : ''}`}>
      {props.view === 'cards' && (
        <SystemPreviewPane
          displayName={displayName}
          isActive={isActive}
          opening={opening}
          preview={props.preview}
          onOpen={() => props.onOpen(entry.id)}
        />
      )}
      <div className="systems-info">
        <input
          className="systems-name-input"
          value={name}
          aria-label={`Name of ${displayName}`}
          onChange={(event) => props.onRename(entry, event.target.value)}
          onKeyDown={blurOnEnter}
          disabled={opening}
        />
        <span className="systems-meta">
          {isActive ? 'Editing now' : `Edited ${props.relativeUpdatedAt}`}
        </span>
      </div>
      <SystemActions
        displayName={displayName}
        isActive={isActive}
        isConfirming={props.isConfirming}
        isOpening={openingId === entry.id}
        opening={opening}
        shared={props.shared}
        onOpen={() => props.onOpen(entry.id)}
        onRevokeShare={() => props.onRevokeShare(entry.id)}
        onDuplicate={() => props.onDuplicate(entry)}
        onRequestDelete={() => props.onRequestDelete(entry.id)}
        onConfirmDelete={() => props.onConfirmDelete(entry.id)}
        onCancelDelete={props.onCancelDelete}
      />
    </li>
  );
}
