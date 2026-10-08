import { z } from 'zod';
import { releaseMarkerPath } from './release-path.js';
export function releaseMarkerAssets(
  assets: Record<string, unknown>,
  publicPath?: string,
): Record<string, unknown> {
  const routing = z
    .union([z.boolean(), z.array(z.string())])
    .optional()
    .parse(assets.run_worker_first);
  if (routing === true) return { ...assets };
  return {
    ...assets,
    run_worker_first: [
      ...new Set([
        ...(Array.isArray(routing) ? routing : []),
        '/lvbt-release.json',
        releaseMarkerPath(publicPath),
      ]),
    ],
  };
}
