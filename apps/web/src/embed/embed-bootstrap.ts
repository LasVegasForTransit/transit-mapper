import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EmbedStartupMilestones } from './startup-milestones';

export interface EmbedMapRuntimeOptions {
  id: string;
  container: HTMLElement;
  system: Promise<TransitSystem>;
  milestones: EmbedStartupMilestones;
}

interface EmbedMapRuntime {
  start(options: EmbedMapRuntimeOptions): Promise<void>;
}

export interface StartEmbedRuntimeOptions {
  id: string;
  container: HTMLElement;
  signal: AbortSignal;
  milestones: EmbedStartupMilestones;
  loadSystem(id: string, signal: AbortSignal): Promise<TransitSystem>;
  loadRuntime(): Promise<EmbedMapRuntime>;
}

/**
 * Start fetching the share before loading MapLibre. The map's style and
 * Worker setup can then overlap the independent API request, preserving the
 * embed's first meaningful map paint while keeping MapLibre out of its shell
 * entry graph.
 */
export async function startEmbedRuntime(options: StartEmbedRuntimeOptions): Promise<void> {
  const system = options.loadSystem(options.id, options.signal);
  const runtime = await options.loadRuntime();
  await runtime.start({
    id: options.id,
    container: options.container,
    system,
    milestones: options.milestones,
  });
}
