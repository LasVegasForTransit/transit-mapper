import type { MapViewStore, SelectionController } from '@transitmapper/map/state';
import { encodeMapViewState, type MapViewStateV1 } from '@transitmapper/views';

export interface AttachViewLinkOptions {
  readonly viewStore: MapViewStore;
  readonly selection: SelectionController;
}

function currentViewState(options: AttachViewLinkOptions): MapViewStateV1 {
  const presentation = options.viewStore.getSnapshot();
  const selection = options.selection.getSnapshot();
  return selection === undefined ? presentation : { ...presentation, selection };
}

function replaceViewFragment(state: MapViewStateV1): void {
  const next = new URL(window.location.href);
  next.hash = `view=${encodeMapViewState(state)}`;
  if (next.href === window.location.href) return;
  window.history.replaceState(window.history.state, '', next);
}

export function attachViewLink(options: AttachViewLinkOptions): () => void {
  const publish = () => replaceViewFragment(currentViewState(options));
  const unsubscribeView = options.viewStore.subscribe(publish);
  const unsubscribeSelection = options.selection.subscribe(publish);
  return () => {
    unsubscribeSelection();
    unsubscribeView();
  };
}

export async function copyViewLink(url = window.location.href): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    return;
  } catch {
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    // The asynchronous Clipboard API can be refused in embedded or restricted
    // browser contexts. execCommand remains the only synchronous copy fallback.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required compatibility fallback after Clipboard API rejection.
    document.execCommand('copy');
    field.remove();
  }
}
