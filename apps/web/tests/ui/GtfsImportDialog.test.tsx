// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';
import { GtfsImportDialog } from '../../src/ui/GtfsImportDialog';

const harness = vi.hoisted(() => ({
  loadFeeds: vi.fn(),
  setImportProgress: vi.fn(),
}));

vi.mock('../../src/import/stream-gtfs-feed', () => ({
  loadPublishedGtfsFeeds: harness.loadFeeds,
  streamGtfsFeedBatches: vi.fn(),
}));

vi.mock('../../src/editor/EditorProvider', () => ({
  useEditorCommands: () => ({
    imports: {
      applyCompletedGtfsImport: vi.fn(),
    },
  }),
  useBackgroundImportStore: () => ({
    getState: () => ({ system: { id: 'system-1' } }),
    subscribe: () => () => undefined,
  }),
}));

vi.mock('../../src/ui/UiProvider', () => ({
  useImportProgress: () => ({ importProgress: null, setImportProgress: harness.setImportProgress }),
}));

interface MockModalProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

vi.mock('../../src/ui/Modal', () => ({
  Modal: ({ title, description, children, footer }: MockModalProps) => (
    <section aria-label={title}>
      <p>{description}</p>
      {children}
      {footer}
    </section>
  ),
}));

vi.mock('../../src/ui/Icon', () => ({ Icon: () => null }));

const RTC_FEED: PublishedGtfsFeed = {
  slug: 'rtc',
  name: 'RTC Southern Nevada',
  region: 'Las Vegas Valley, Nevada',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  harness.loadFeeds.mockReset();
  harness.setImportProgress.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderDialog(): Promise<void> {
  await act(async () => {
    root.render(<GtfsImportDialog onClose={vi.fn()} />);
    await Promise.resolve();
  });
}

describe('published GTFS import dialog', () => {
  it('shows the feed picker even when the catalog contains one feed', async () => {
    harness.loadFeeds.mockResolvedValue([RTC_FEED]);

    await renderDialog();

    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Import a published transit feed',
    );
    const picker = container.querySelector<HTMLSelectElement>('select[name="gtfs-feed"]');
    expect(picker).not.toBeNull();
    expect(picker?.value).toBe('rtc');
    expect(picker?.textContent).toContain('RTC Southern Nevada');
    expect(container.textContent).toContain('Las Vegas Valley, Nevada');
    expect(container.querySelector<HTMLButtonElement>('button.primary-btn')?.disabled).toBe(false);
  });

  it('keeps import disabled and retries when the feed catalog is unavailable', async () => {
    harness.loadFeeds
      .mockRejectedValueOnce(new Error('Published transit feeds are unavailable (503).'))
      .mockResolvedValueOnce([RTC_FEED]);

    await renderDialog();

    expect(container.textContent).toContain('Published transit feeds are unavailable (503).');
    expect(container.querySelector<HTMLButtonElement>('button.primary-btn')?.disabled).toBe(true);
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(harness.loadFeeds).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLSelectElement>('select[name="gtfs-feed"]')?.value).toBe(
      'rtc',
    );
  });
});
