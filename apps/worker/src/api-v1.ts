import { Hono } from 'hono';
import { gtfsArchiveResponse, listGtfsFeedsResponse } from './gtfs-api';
import { createViewsApi, type ViewsApiDependencies } from './views-api';

interface ApiV1Env {
  Bindings: Pick<Env, 'DB' | 'GTFS_ARCHIVES'> & Partial<Pick<Env, 'VIEW_CREATE_LIMITER'>>;
}

/** New public resources register on this router once. The parent Worker owns
 * the version prefix, so endpoint modules do not repeat or drift from it. */
export function createApiV1(viewsDependencies: ViewsApiDependencies): Hono<ApiV1Env> {
  const apiV1 = new Hono<ApiV1Env>();

  apiV1.get('/gtfs', () => listGtfsFeedsResponse());
  apiV1.get('/gtfs/:slug', (c) => gtfsArchiveResponse(c.req.param('slug'), c.env.GTFS_ARCHIVES));
  apiV1.route('/views', createViewsApi(viewsDependencies));

  return apiV1;
}
