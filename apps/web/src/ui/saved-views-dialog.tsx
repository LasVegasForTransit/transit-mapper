import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapViewStore, SelectionController } from '@transitmapper/map';
import { useState } from 'react';
import { browserSavedViewsServices, type SavedViewsServices } from '../views/saved-views-services';
import { restoreSavedView } from '../views/saved-views';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { SavedViewRow } from './saved-view-row';
import { useSavedViewsDialogState } from './saved-views-dialog-state';

export type { SavedViewsServices } from '../views/saved-views-services';

export interface SavedViewsDialogProps {
  onClose: () => void;
  system: TransitSystem;
  viewStore: MapViewStore;
  selection: SelectionController;
  services?: SavedViewsServices;
}

interface CreateViewFormProps {
  draft: string;
  setDraft: (value: string) => void;
  cancel: () => void;
  submit: ReturnType<typeof useSavedViewsDialogState>['create'];
}

function CreateViewForm({ draft, setDraft, cancel, submit }: CreateViewFormProps) {
  return (
    <form className="saved-view-create" onSubmit={(event) => void submit(event)}>
      <input
        className="saved-view-name-input"
        aria-label="View name"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel();
        }}
      />
      <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
        Save
      </button>
      <button type="button" className="btn btn-plain" onClick={cancel}>
        Cancel
      </button>
    </form>
  );
}

export function SavedViewsDialog({
  onClose,
  system,
  viewStore,
  selection,
  services,
}: SavedViewsDialogProps) {
  const [activeServices] = useState(() => services ?? browserSavedViewsServices());
  const state = useSavedViewsDialogState({
    system,
    viewStore,
    selection,
    services: activeServices,
  });
  return (
    <Modal
      title="Saved views"
      description="Save and restore a map position, visible layers, and selection."
      onClose={onClose}
      className="saved-views-dialog"
    >
      <div className="saved-views-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={state.startCreate}
          disabled={state.creating}
        >
          <Icon name="plus" size={17} /> Save current view
        </button>
      </div>

      {state.creating && (
        <CreateViewForm
          draft={state.createDraft}
          setDraft={state.setCreateDraft}
          cancel={state.cancelCreate}
          submit={state.create}
        />
      )}

      <ul className="saved-views-list" aria-busy={state.loading || undefined}>
        {state.loading && <li className="panel-hint">Loading saved views…</li>}
        {!state.loading && state.libraryError && (
          <li className="saved-views-empty">
            <span>Saved views are unavailable.</span>
            <button type="button" className="btn btn-bordered" onClick={() => void state.load()}>
              Try again
            </button>
          </li>
        )}
        {!state.loading && !state.libraryError && state.views.length === 0 && (
          <li className="saved-views-empty">No saved views yet.</li>
        )}
        {state.views.map((view) => (
          <SavedViewRow
            key={view.id}
            view={view}
            busy={state.busyId === view.id}
            editing={state.editingId === view.id}
            confirmingDelete={state.confirmingId === view.id}
            linkVisible={state.revealedLinkId === view.id}
            error={state.errors[view.id] || undefined}
            onOpen={() => {
              restoreSavedView(view, viewStore, selection);
              onClose();
            }}
            onStartRename={() => state.startRename(view.id)}
            onRename={(title) => state.rename(view, title)}
            onCancelRename={state.cancelRename}
            onShare={() => state.share(view)}
            onRequestDelete={() => state.requestDelete(view.id)}
            onCancelDelete={state.cancelDelete}
            onConfirmDelete={() => state.remove(view)}
          />
        ))}
      </ul>
    </Modal>
  );
}
