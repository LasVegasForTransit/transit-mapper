import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';
import { useBackgroundImportStore, useEditorCommands } from '../editor/EditorProvider';
import { startGtfsImport } from '../import/run-gtfs-import';
import { usePublishedGtfsFeeds } from '../import/use-published-gtfs-feeds';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useImportProgress } from './UiProvider';

interface GtfsImportDialogProps {
  onClose: () => void;
}

interface GtfsFeedPickerProps {
  feeds: PublishedGtfsFeed[];
  selectedSlug: string;
  selectedFeed: PublishedGtfsFeed | undefined;
  loading: boolean;
  error: string | null;
  onSelect: (slug: string) => void;
  onRetry: () => void;
}

function GtfsFeedPicker({
  feeds,
  selectedSlug,
  selectedFeed,
  loading,
  error,
  onSelect,
  onRetry,
}: GtfsFeedPickerProps) {
  return (
    <>
      <label className="field-label" htmlFor="gtfs-feed">
        Transit feed
      </label>
      <select
        id="gtfs-feed"
        name="gtfs-feed"
        className="opt-select"
        value={selectedSlug}
        onChange={(event) => onSelect(event.target.value)}
        disabled={loading || feeds.length === 0}
      >
        {feeds.map((feed) => (
          <option key={feed.slug} value={feed.slug}>
            {feed.name}
          </option>
        ))}
      </select>
      {selectedFeed && <p className="panel-hint">{selectedFeed.region}</p>}
      {loading && <p className="panel-hint">Loading published transit feeds…</p>}
      {error && (
        <div className="panel-hint" role="alert">
          {error}{' '}
          <button type="button" className="link-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}

export function GtfsImportDialog({ onClose }: GtfsImportDialogProps) {
  const commands = useEditorCommands().imports;
  const store = useBackgroundImportStore();
  const { importProgress, setImportProgress } = useImportProgress();
  const catalog = usePublishedGtfsFeeds();
  const importRunning = importProgress?.state === 'loading';
  const importDisabled = importRunning || catalog.loading || !catalog.selectedFeed;

  const run = () => {
    if (importDisabled || !catalog.selectedFeed) return;
    startGtfsImport({
      feed: catalog.selectedFeed,
      store,
      commands,
      setImportProgress,
      onStarted: onClose,
    });
  };

  return (
    <Modal
      title="Import a published transit feed"
      description="Choose a current public transit feed to import as a comparison baseline."
      onClose={onClose}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
          onClick={run}
          disabled={importDisabled}
        >
          <Icon name="download" size={18} />{' '}
          {importRunning ? 'Import already running' : 'Import into this system'}
        </button>
      }
    >
      <p className="panel-hint">
        The selected feed adds its published routes, stops, and alignments to this system. The map
        updates a few routes at a time while you keep working.
      </p>
      <GtfsFeedPicker
        feeds={catalog.feeds}
        selectedSlug={catalog.selectedSlug}
        selectedFeed={catalog.selectedFeed}
        loading={catalog.loading}
        error={catalog.error}
        onSelect={catalog.setSelectedSlug}
        onRetry={catalog.retry}
      />
    </Modal>
  );
}
