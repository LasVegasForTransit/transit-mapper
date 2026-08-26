import { shortId } from '@transitmapper/core/model/ids';
import {
  MAX_VIEW_API_BODY_BYTES,
  ViewParseError,
  parseCreateViewRequestJson,
  parseMapViewState,
  parseUpdateViewRequestJson,
  type CreateViewResponse,
  type GetViewResponse,
  type MapViewStateV1,
  type SavedViewV1,
} from '@transitmapper/views';
import { Hono, type Context, type Handler } from 'hono';
import {
  anonymousExpiry,
  randomEditToken,
  sha256Hex,
  shouldTouchAnonymousExpiry,
} from './anonymous-resource';

const VIEW_ID_PATTERN = /^[0-9a-z]{1,32}$/;

export interface ViewApiBindings {
  DB: D1Database;
  VIEW_CREATE_LIMITER?: RateLimit;
}

interface ViewApiEnv {
  Bindings: ViewApiBindings;
}

export interface ReferencedSharedSystem {
  touch(): Promise<unknown> | null;
}

export interface ViewsApiDependencies {
  getSharedSystem(db: D1Database, id: string): Promise<ReferencedSharedSystem | null>;
}

interface ViewRow {
  id: string;
  schema_version: number;
  title: string;
  description: string | null;
  shared_system_id: string;
  state_json: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  edit_token_hash: string | null;
}

interface ActiveView {
  row: ViewRow;
  state: MapViewStateV1;
}

export interface PublishedViewResource {
  response: GetViewResponse;
  expiresAt: number | null;
}

interface BoundedBody {
  raw: string;
}

function viewResponse(view: ActiveView): GetViewResponse {
  const savedView: SavedViewV1 = {
    schemaVersion: 1,
    id: view.row.id,
    title: view.row.title,
    map: { kind: 'shared-system', id: view.row.shared_system_id },
    state: view.state,
  };
  if (view.row.description !== null) savedView.description = view.row.description;
  return {
    view: savedView,
    createdAt: view.row.created_at,
    updatedAt: view.row.updated_at,
  };
}

async function getActiveView(db: D1Database, id: string): Promise<ActiveView | null> {
  if (!VIEW_ID_PATTERN.test(id)) return null;

  const row = await db
    .prepare(
      `SELECT id, schema_version, title, description, shared_system_id,
              state_json, created_at, updated_at, expires_at, edit_token_hash
       FROM views WHERE id = ?`,
    )
    .bind(id)
    .first<ViewRow>();
  if (!row) return null;

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM views WHERE id = ?').bind(id).run();
    return null;
  }

  try {
    return { row, state: parseMapViewState(JSON.parse(row.state_json)) };
  } catch {
    console.error(`View ${id} has invalid state`);
    await db.prepare('DELETE FROM views WHERE id = ?').bind(id).run();
    return null;
  }
}

export async function readPublishedViewResource(
  db: D1Database,
  id: string,
): Promise<PublishedViewResource | null> {
  const active = await getActiveView(db, id);
  return active ? { response: viewResponse(active), expiresAt: active.row.expires_at } : null;
}

export function touchPublishedViewResource(
  db: D1Database,
  resource: PublishedViewResource,
): Promise<unknown> | null {
  const now = Date.now();
  if (!shouldTouchAnonymousExpiry(resource.expiresAt, now)) return null;
  return db
    .prepare('UPDATE views SET expires_at = ? WHERE id = ?')
    .bind(anonymousExpiry(now), resource.response.view.id)
    .run()
    .catch(() => undefined);
}

export async function deletePublishedViewResource(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM views WHERE id = ?').bind(id).run();
}

function touchViewExpiry(db: D1Database, view: ActiveView): Promise<unknown> | null {
  const now = Date.now();
  if (!shouldTouchAnonymousExpiry(view.row.expires_at, now)) return null;
  return db
    .prepare('UPDATE views SET expires_at = ? WHERE id = ?')
    .bind(anonymousExpiry(now), view.row.id)
    .run()
    .catch(() => undefined);
}

async function boundedBody(c: Context<ViewApiEnv>): Promise<BoundedBody | Response> {
  const declaredLength = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VIEW_API_BODY_BYTES) {
    return c.json({ error: 'View request too large' }, 413);
  }

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_VIEW_API_BODY_BYTES) {
    return c.json({ error: 'View request too large' }, 413);
  }
  return { raw };
}

async function enforceCreateRateLimit(c: Context<ViewApiEnv>): Promise<Response | null> {
  const clientIp = c.req.header('cf-connecting-ip');
  if (!clientIp) return null;
  if (!c.env.VIEW_CREATE_LIMITER) {
    console.error('VIEW_CREATE_LIMITER binding missing — refusing unlimited View creation');
    return c.json({ error: 'View creation is temporarily unavailable' }, 503);
  }
  const { success } = await c.env.VIEW_CREATE_LIMITER.limit({ key: clientIp });
  return success ? null : c.json({ error: 'Too many Views created. Try again in a minute.' }, 429);
}

function invalidViewResponse(c: Context<ViewApiEnv>, error: unknown): Response {
  const message = error instanceof ViewParseError ? error.message : 'View request is invalid';
  return c.json({ error: message }, 400);
}

async function deleteDanglingView(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM views WHERE id = ?').bind(id).run();
}

function createViewHandler(dependencies: ViewsApiDependencies): Handler<ViewApiEnv> {
  return async (c) => {
    const limited = await enforceCreateRateLimit(c);
    if (limited) return limited;

    const body = await boundedBody(c);
    if (body instanceof Response) return body;

    let request;
    try {
      request = parseCreateViewRequestJson(body.raw);
    } catch (error) {
      return invalidViewResponse(c, error);
    }

    const sharedSystem = await dependencies.getSharedSystem(c.env.DB, request.sharedSystemId);
    if (!sharedSystem) return c.json({ error: 'Shared system not found' }, 404);

    const now = Date.now();
    const id = shortId(10);
    const editToken = randomEditToken();
    const editTokenHash = await sha256Hex(editToken);
    await c.env.DB.prepare(
      `INSERT INTO views
         (id, schema_version, title, description, shared_system_id, state_json,
          created_at, updated_at, expires_at, edit_token_hash)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        request.title,
        request.description ?? null,
        request.sharedSystemId,
        JSON.stringify(request.state),
        now,
        now,
        anonymousExpiry(now),
        editTokenHash,
      )
      .run();

    const response: CreateViewResponse = {
      ...viewResponse({
        row: {
          id,
          schema_version: 1,
          title: request.title,
          description: request.description ?? null,
          shared_system_id: request.sharedSystemId,
          state_json: JSON.stringify(request.state),
          created_at: now,
          updated_at: now,
          expires_at: anonymousExpiry(now),
          edit_token_hash: editTokenHash,
        },
        state: request.state,
      }),
      editToken,
    };
    const shareTouch = sharedSystem.touch();
    if (shareTouch) c.executionCtx.waitUntil(shareTouch);
    return c.json(response, 201);
  };
}

function getViewHandler(dependencies: ViewsApiDependencies): Handler<ViewApiEnv> {
  return async (c) => {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Not found' }, 404);
    const view = await getActiveView(c.env.DB, id);
    if (!view) return c.json({ error: 'Not found' }, 404);

    const sharedSystem = await dependencies.getSharedSystem(c.env.DB, view.row.shared_system_id);
    if (!sharedSystem) {
      await deleteDanglingView(c.env.DB, view.row.id);
      return c.json({ error: 'Not found' }, 404);
    }

    const viewTouch = touchViewExpiry(c.env.DB, view);
    if (viewTouch) c.executionCtx.waitUntil(viewTouch);
    const shareTouch = sharedSystem.touch();
    if (shareTouch) c.executionCtx.waitUntil(shareTouch);
    return c.json(viewResponse(view));
  };
}

function updateViewHandler(dependencies: ViewsApiDependencies): Handler<ViewApiEnv> {
  return async (c) => {
    const id = c.req.param('id');
    if (!id || !VIEW_ID_PATTERN.test(id)) return c.json({ error: 'Not found' }, 404);
    const editToken = c.req.header('x-edit-token');
    if (!editToken) return c.json({ error: 'Missing edit token' }, 403);

    const body = await boundedBody(c);
    if (body instanceof Response) return body;
    let request;
    try {
      request = parseUpdateViewRequestJson(body.raw);
    } catch (error) {
      return invalidViewResponse(c, error);
    }

    const current = await getActiveView(c.env.DB, id);
    if (!current) return c.json({ error: 'Not found' }, 404);
    const sharedSystem = await dependencies.getSharedSystem(c.env.DB, current.row.shared_system_id);
    if (!sharedSystem) {
      await deleteDanglingView(c.env.DB, id);
      return c.json({ error: 'Not found' }, 404);
    }

    const now = Date.now();
    const title = request.title ?? current.row.title;
    const description =
      request.description === undefined ? current.row.description : request.description;
    const state = request.state ?? current.state;
    const tokenHash = await sha256Hex(editToken);
    const result = await c.env.DB.prepare(
      `UPDATE views
       SET title = ?, description = ?, state_json = ?, updated_at = ?,
           expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ? END
       WHERE id = ? AND edit_token_hash = ?`,
    )
      .bind(title, description, JSON.stringify(state), now, anonymousExpiry(now), id, tokenHash)
      .run();
    if (result.meta.changes === 0) {
      return c.json({ error: 'Not authorized to edit this View' }, 403);
    }

    const shareTouch = sharedSystem.touch();
    if (shareTouch) c.executionCtx.waitUntil(shareTouch);
    return c.json(
      viewResponse({
        row: {
          ...current.row,
          title,
          description,
          state_json: JSON.stringify(state),
          updated_at: now,
          expires_at: current.row.expires_at === null ? null : anonymousExpiry(now),
        },
        state,
      }),
    );
  };
}

function deleteViewHandler(): Handler<ViewApiEnv> {
  return async (c) => {
    const id = c.req.param('id');
    if (!id || !VIEW_ID_PATTERN.test(id)) return c.json({ error: 'Not found' }, 404);
    const editToken = c.req.header('x-edit-token');
    if (!editToken) return c.json({ error: 'Missing edit token' }, 403);

    const tokenHash = await sha256Hex(editToken);
    const result = await c.env.DB.prepare('DELETE FROM views WHERE id = ? AND edit_token_hash = ?')
      .bind(id, tokenHash)
      .run();
    if (result.meta.changes === 0) {
      return c.json({ error: 'Not authorized to delete this View' }, 403);
    }
    return c.body(null, 204);
  };
}

export function createViewsApi(dependencies: ViewsApiDependencies): Hono<ViewApiEnv> {
  const views = new Hono<ViewApiEnv>();
  views.post('/', createViewHandler(dependencies));
  views.get('/:id', getViewHandler(dependencies));
  views.patch('/:id', updateViewHandler(dependencies));
  views.delete('/:id', deleteViewHandler());

  return views;
}
