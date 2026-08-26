import { useEffect, useState, type FormEvent } from 'react';
import type { LocalViewRecord } from '../views/local-view-library';
import { copyViewLink } from '../views/view-link';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu';
import { Icon } from './Icon';

export interface SavedViewRowProps {
  view: LocalViewRecord;
  busy: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  linkVisible: boolean;
  error?: string;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
  onShare: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

interface RenameFormProps {
  view: LocalViewRecord;
  onRename: (title: string) => void;
  onCancel: () => void;
}

function RenameForm({ view, onRename, onCancel }: RenameFormProps) {
  const [draft, setDraft] = useState(view.title);
  useEffect(() => setDraft(view.title), [view.title]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) onRename(draft);
  };
  return (
    <form className="saved-view-rename" onSubmit={submit}>
      <input
        className="saved-view-name-input"
        aria-label={`Rename ${view.title}`}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      />
      <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
        Save
      </button>
      <button type="button" className="btn btn-plain" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

interface DeleteConfirmationProps {
  view: LocalViewRecord;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteConfirmation({ view, onCancel, onConfirm }: DeleteConfirmationProps) {
  return (
    <div className="saved-view-confirmation">
      <span>
        {view.publishedId
          ? 'Public and embedded links will stop working.'
          : 'The transit system will remain unchanged.'}
      </span>
      <div>
        <button type="button" className="btn btn-plain" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {view.publishedId ? 'Delete and stop sharing' : 'Delete saved view'}
        </button>
      </div>
    </div>
  );
}

function PublishedLink({ view }: { view: LocalViewRecord }) {
  if (!view.publishedId) return null;
  const link = `${window.location.origin}/v/${encodeURIComponent(view.publishedId)}`;
  return (
    <div className="saved-view-link-row">
      <input
        aria-label={`Link to ${view.title}`}
        value={link}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="btn btn-bordered" onClick={() => void copyViewLink(link)}>
        <Icon name="copy" size={16} /> Copy link
      </button>
      <a className="btn btn-plain" href={link} target="_blank" rel="noreferrer">
        Open
      </a>
    </div>
  );
}

export function SavedViewRow(props: SavedViewRowProps) {
  return (
    <li className="saved-view-row" aria-busy={props.busy || undefined}>
      <div className="saved-view-main">
        {props.editing ? (
          <RenameForm view={props.view} onRename={props.onRename} onCancel={props.onCancelRename} />
        ) : (
          <>
            <div className="saved-view-info">
              <strong>{props.view.title}</strong>
              <span>{props.view.publishedId ? 'Shared' : 'Only on this device'}</span>
            </div>
            <div className="saved-view-actions">
              <button
                type="button"
                className="btn btn-primary"
                aria-label={`Open ${props.view.title}`}
                disabled={props.busy}
                onClick={props.onOpen}
              >
                Open
              </button>
              <DropdownMenu
                trigger={
                  <button
                    type="button"
                    className="mobile-more-btn"
                    aria-label={`Actions for ${props.view.title}`}
                    disabled={props.busy}
                  >
                    ⋯
                  </button>
                }
              >
                <DropdownMenuItem onSelect={props.onStartRename}>Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onShare}>Share</DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onRequestDelete}>Delete</DropdownMenuItem>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
      {props.confirmingDelete && (
        <DeleteConfirmation
          view={props.view}
          onCancel={props.onCancelDelete}
          onConfirm={props.onConfirmDelete}
        />
      )}
      {props.linkVisible && <PublishedLink view={props.view} />}
      {props.error && (
        <p className="error-text saved-view-error" role="alert">
          {props.error}
        </p>
      )}
    </li>
  );
}
