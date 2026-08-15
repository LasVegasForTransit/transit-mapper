import '../theme/font.css';
import { parseSystem } from '@transitmapper/core/model/serialize';
import type { GetShareResponse } from '@transitmapper/core/share/contract';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import { createEmbedStartupMilestones } from './startup-milestones';
import { startFieldSampling } from '../perf/field-sampling';
import { startEmbedRuntime } from './embed-bootstrap';

const startupMilestones = createEmbedStartupMilestones();
startupMilestones.bootstrapStarted();
startFieldSampling('embed');

// The embedded map: a live, read-only view of one shared system, meant to sit
// in someone else's article. The map runtime loads immediately after its
// static shell commits; this entry keeps only loading/error state and never
// pulls in React, editing chrome, or MapLibre itself.

function shareIdFromPath(pathname: string): string | null {
  const match = /^\/e\/([0-9a-z]{1,32})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

function fail(message: string): void {
  const el = document.getElementById('embed-status');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

async function loadSystem(id: string, signal: AbortSignal): Promise<TransitSystem> {
  const res = await fetchWithTimeout(`/api/systems/${encodeURIComponent(id)}`, {}, { signal });
  if (res.status === 404) throw new Error('This shared system was not found.');
  if (!res.ok) throw new Error(`Couldn't load this system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}

async function start(): Promise<void> {
  startupMilestones.shellMounted();
  const id = shareIdFromPath(window.location.pathname);
  if (!id) {
    fail('No system to show.');
    return;
  }

  const container = document.getElementById('map');
  if (!container) {
    fail('No map container was found.');
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Embed closed.', 'AbortError'));
  window.addEventListener('pagehide', cancel, { once: true });
  try {
    await startEmbedRuntime({
      id,
      container,
      signal: controller.signal,
      milestones: startupMilestones,
      loadSystem,
      loadRuntime: () =>
        import('./embed-map-runtime').then(({ startEmbedMap }) => ({ start: startEmbedMap })),
    });
  } catch (error) {
    // An embed is nothing but a remote system on a remote basemap, so being
    // offline explains the entire failure and the exception text explains
    // none of it. Checked here rather than subscribed to: this page has no
    // React and nothing to re-render if the network comes back.
    fail(
      navigator.onLine
        ? (error as Error).message
        : 'This map needs a connection, and the browser is offline.',
    );
  } finally {
    window.removeEventListener('pagehide', cancel);
  }
}

void start();
