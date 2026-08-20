import { Hono } from 'hono';
import { gtfsArchiveResponse, listGtfsFeedsResponse } from './gtfs-api';

interface ApiV1Env {
  Bindings: Pick<Env, 'GTFS_ARCHIVES'>;
}

/** New public resources register on this router once. The parent Worker owns
 * the version prefix, so endpoint modules do not repeat or drift from it. */
export const apiV1 = new Hono<ApiV1Env>();

apiV1.get('/gtfs', () => listGtfsFeedsResponse());
apiV1.get('/gtfs/:slug', (c) => gtfsArchiveResponse(c.req.param('slug'), c.env.GTFS_ARCHIVES));
