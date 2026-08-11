import type { TransitSystem } from '@transitmapper/core/model/system';
import type { LibraryLoadResult } from '../storage/browserLibrary';

export type SystemPreview = { status: 'ready'; svg: string } | { status: 'unavailable' };

interface LoadSystemPreviewsOptions {
  ids: string[];
  load: (id: string) => Promise<LibraryLoadResult>;
  render: (system: TransitSystem) => string;
  onPreview: (id: string, preview: SystemPreview) => void;
  concurrency?: number;
  isCancelled?: () => boolean;
}

export async function loadSystemPreviews({
  ids,
  load,
  render,
  onPreview,
  concurrency = 3,
  isCancelled = () => false,
}: LoadSystemPreviewsOptions): Promise<void> {
  let nextIndex = 0;

  const work = async (): Promise<void> => {
    while (!isCancelled()) {
      const index = nextIndex++;
      const id = ids[index];
      if (id === undefined) return;

      let preview: SystemPreview;
      try {
        const result = await load(id);
        preview =
          result.status === 'ok'
            ? { status: 'ready', svg: render(result.system) }
            : { status: 'unavailable' };
      } catch {
        preview = { status: 'unavailable' };
      }
      if (!isCancelled()) onPreview(id, preview);
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), ids.length);
  await Promise.all(Array.from({ length: workerCount }, () => work()));
}
