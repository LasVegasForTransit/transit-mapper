/** New public API resources mount under one version prefix. Existing legacy
 * routes remain stable until callers migrate through a separate release. */
export const API_V1_PREFIX = '/api/v1';

export type ApiV1ResourcePath = `/${string}`;

export function apiV1Path(resourcePath: ApiV1ResourcePath): string {
  return `${API_V1_PREFIX}${resourcePath}`;
}
