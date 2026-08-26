import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapViewStateV1 } from '@transitmapper/views';
import type { EmbedStartupMilestones } from './startup-milestones';

export type EmbedReference =
  { kind: 'shared-system'; id: string } | { kind: 'published-view'; id: string };

export interface EmbedContent {
  system: TransitSystem;
  state: MapViewStateV1;
  title: string;
  openPath: string;
}

export interface EmbedMapRuntimeOptions {
  reference: EmbedReference;
  container: HTMLElement;
  content: Promise<EmbedContent>;
  milestones: EmbedStartupMilestones;
}

interface EmbedMapRuntime {
  start(options: EmbedMapRuntimeOptions): Promise<void>;
}

export interface StartEmbedRuntimeOptions {
  reference: EmbedReference;
  container: HTMLElement;
  signal: AbortSignal;
  milestones: EmbedStartupMilestones;
  loadContent(reference: EmbedReference, signal: AbortSignal): Promise<EmbedContent>;
  loadRuntime(): Promise<EmbedMapRuntime>;
}

export function parseEmbedReference(pathname: string): EmbedReference | null {
  const sharedSystemId = /^\/e\/([0-9a-z]{1,32})\/?$/.exec(pathname)?.[1];
  if (sharedSystemId) return { kind: 'shared-system', id: sharedSystemId };
  const publishedViewId = /^\/embed\/([0-9a-z]{1,32})\/?$/.exec(pathname)?.[1];
  return publishedViewId ? { kind: 'published-view', id: publishedViewId } : null;
}

/**
 * Start fetching the share before loading MapLibre. The map's style and
 * Worker setup can then overlap the independent API request, preserving the
 * embed's first meaningful map paint while keeping MapLibre out of its shell
 * entry graph.
 */
export async function startEmbedRuntime(options: StartEmbedRuntimeOptions): Promise<void> {
  const content = options.loadContent(options.reference, options.signal);
  const runtime = await options.loadRuntime();
  await runtime.start({
    reference: options.reference,
    container: options.container,
    content,
    milestones: options.milestones,
  });
}
