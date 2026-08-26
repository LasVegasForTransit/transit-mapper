import '../theme/font.css';
import { parseSystem } from '@transitmapper/core/model/serialize';
import type { GetShareResponse } from '@transitmapper/core/share/contract';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { parseMapViewState } from '@transitmapper/views';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import { createEmbedStartupMilestones } from './startup-milestones';
import { startFieldSampling } from '../perf/field-sampling';
import {
  parseEmbedReference,
  startEmbedRuntime,
  type EmbedContent,
  type EmbedReference,
} from './embed-bootstrap';
import { fetchPublishedView } from '../views/api';

const startupMilestones = createEmbedStartupMilestones();
startupMilestones.bootstrapStarted();
startFieldSampling('embed');

// The embedded map: a live, read-only view of one shared system, meant to sit
// in someone else's article. The map runtime loads immediately after its
// static shell commits; this entry keeps only loading/error state and never
// pulls in React, editing chrome, or MapLibre itself.

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

async function loadEmbedContent(
  reference: EmbedReference,
  signal: AbortSignal,
): Promise<EmbedContent> {
  if (reference.kind === 'shared-system') {
    const system = await loadSystem(reference.id, signal);
    return {
      system,
      title: system.name || 'Transit system',
      openPath: `/s/${reference.id}`,
      state: {
        schemaVersion: 1,
        camera: system.viewport,
        representationId: 'network',
        filters: {
          modes: [...MODE_ORDER],
          'way-types': [...WAY_TYPE_ORDER],
          landmarks: true,
        },
      },
    };
  }

  const published = await fetchPublishedView(reference.id, { signal });
  const system = await loadSystem(published.view.map.id, signal);
  return {
    system,
    title: published.view.title,
    openPath: `/v/${reference.id}`,
    state: parseMapViewState(published.view.state),
  };
}

async function start(): Promise<void> {
  startupMilestones.shellMounted();
  const reference = parseEmbedReference(window.location.pathname);
  if (!reference) {
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
      reference,
      container,
      signal: controller.signal,
      milestones: startupMilestones,
      loadContent: loadEmbedContent,
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
