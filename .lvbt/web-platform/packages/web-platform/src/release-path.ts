import { z } from 'zod';
export const publicPathSchema = z.string().regex(/^\/(?:[a-z0-9-]+\/)*$/);
export function releaseMarkerPath(publicPath = '/'): string {
  const prefix = publicPathSchema.parse(publicPath);
  return `${prefix}lvbt-release.json`;
}
export function productionEndpoint(config: {
  productionUrl: string;
  publicPath?: string | undefined;
}): string {
  const prefix = publicPathSchema.parse(config.publicPath ?? '/');
  return `${config.productionUrl}${prefix === '/' ? '' : prefix}`;
}
