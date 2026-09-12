import {
  transitApiErrorStatus,
  type TransitApiError,
  type TransitApiErrorCode,
  type TransitApiFailure,
  type TransitApiSuccess,
} from '@transitmapper/core/network/api-contract';
import type { ContentProvider } from '@transitmapper/core/network/content-provider';
import type { ContentRef } from '@transitmapper/core/network/content-reference';
import {
  parseContentRef,
  parseNetworkQuery,
  parseResolvedContentRef,
} from '@transitmapper/core/network/parse-request';
import type { ResolvedContentRef } from '@transitmapper/core/network/resolved-content-reference';
import {
  createSchemaV17SystemProvider,
  SchemaV17SystemProviderError,
} from '@transitmapper/core/network/schema-v17-system-provider';
import { createSystemContentProvider } from '@transitmapper/core/network/system-content-provider';
import type { TransitSystem as SchemaV16TransitSystem } from '@transitmapper/core/model/system';
import { Hono, type Context, type Handler } from 'hono';
import { getCurrentSystemRevision, getSystemRevision } from './system-revisions';

/** A network query is a camera box, a mode list, and a handful of filters. The
 * bound exists so a caller cannot make the Worker parse megabytes before it
 * discovers the request is nonsense. */
const MAX_TRANSIT_API_BODY_BYTES = 64 * 1024;

interface TransitApiBindings {
  DB: D1Database;
}

interface TransitApiEnv {
  Bindings: TransitApiBindings;
}

export interface TransitApiDependencies {
  /**
   * The mutable document a System is being authored against, or null when no
   * live row holds it. Injected rather than queried here because share expiry,
   * unparseable-row handling, and ID vetting already live in one place.
   */
  getWorkingSystem(db: D1Database, id: string): Promise<SchemaV16TransitSystem | null>;
}

function failure(error: TransitApiError): TransitApiFailure {
  return { version: 'transit-network-v1', error };
}

function success<Value>(result: Value): TransitApiSuccess<Value> {
  return { version: 'transit-network-v1', result };
}

function apiError(code: TransitApiErrorCode, message: string, retryable = false): TransitApiError {
  return { code, message, retryable };
}

/**
 * Turns whatever a provider or repository threw into one wire error.
 *
 * An unrecognised throw becomes `internal` with a fixed message: the thing
 * that failed may have a stored document in its message, and that document is
 * someone's unpublished work.
 */
function wireError(error: unknown): TransitApiError {
  if (error instanceof SchemaV17SystemProviderError) {
    if (error.code === 'invalid-authored-system') {
      return apiError('content-unavailable', 'The stored System document is not valid content.');
    }
    return apiError(error.code, error.message);
  }
  console.error('Transit content request failed', error);
  return apiError('internal', 'The transit content request could not be completed.');
}

interface ResolvedProvider {
  provider: ContentProvider;
  /** Which document shape answered, so a caller can say so rather than infer
   * it from the geometry it got back. */
  schema: 16 | 17;
}

async function publishedProvider(
  db: D1Database,
  systemId: string,
  systemRevisionId: string,
): Promise<ResolvedProvider> {
  const revision = await getSystemRevision(db, systemRevisionId);
  // A revision that belongs to another System is reported as missing rather
  // than as a mismatch. The caller has proved nothing about the other System,
  // and confirming that ID exists would answer a question it did not ask.
  if (revision?.systemId !== systemId) {
    throw new SchemaV17SystemProviderError(
      'revision-not-found',
      'No published revision of this System has that identity.',
    );
  }
  return {
    provider: createSchemaV17SystemProvider(revision.system, {
      contentId: systemId,
      publication: { systemRevisionId: revision.id },
    }),
    schema: 17,
  };
}

async function workingProvider(
  db: D1Database,
  dependencies: TransitApiDependencies,
  systemId: string,
): Promise<ResolvedProvider> {
  const system = await dependencies.getWorkingSystem(db, systemId);
  if (!system) {
    throw new SchemaV17SystemProviderError('content-not-found', 'No such System is available.');
  }
  // An incompatible legacy document still opens: createSystemContentProvider
  // hands back the v16 provider rather than refusing, because the person who
  // authored the map must be able to see it.
  const { provider, schema } = createSystemContentProvider(system, { contentId: systemId });
  return { provider, schema };
}

async function providerForReference(
  db: D1Database,
  dependencies: TransitApiDependencies,
  reference: ContentRef,
): Promise<ResolvedProvider> {
  if (reference.kind !== 'transit-system') {
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'Only TransitSystem content is served here.',
    );
  }
  if (reference.revision.kind === 'pinned') {
    return publishedProvider(db, reference.id, reference.revision.systemRevisionId);
  }
  // `latest` means the newest immutable publication, and falls through to the
  // working document only when nobody has published one. A System that has
  // never been published still has content worth showing.
  const head = await getCurrentSystemRevision(db, reference.id);
  if (head) {
    return {
      provider: createSchemaV17SystemProvider(head.system, {
        contentId: reference.id,
        publication: { systemRevisionId: head.id },
      }),
      schema: 17,
    };
  }
  return workingProvider(db, dependencies, reference.id);
}

async function providerForResolvedReference(
  db: D1Database,
  dependencies: TransitApiDependencies,
  content: ResolvedContentRef,
): Promise<ResolvedProvider> {
  if (content.kind !== 'transit-system') {
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'Only TransitSystem content is served here.',
    );
  }
  if (content.revision.kind === 'published') {
    return publishedProvider(db, content.id, content.revision.systemRevisionId);
  }
  // The digest the caller carries is checked by the provider itself, which
  // rejects a working reference that no longer matches the document.
  return workingProvider(db, dependencies, content.id);
}

/** Tagged rather than discriminated by which fields happen to be present:
 * the two arms are otherwise unrelated shapes, so `'value' in body` read as a
 * shape probe rather than as "did this parse". */
type RequestBody =
  { ok: true; value: Record<string, unknown> } | { ok: false; error: TransitApiError };

async function boundedRequest(c: Context<TransitApiEnv>): Promise<RequestBody> {
  const declaredLength = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSIT_API_BODY_BYTES) {
    return {
      ok: false,
      error: apiError('invalid-request', 'The transit content request is too large.'),
    };
  }
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_TRANSIT_API_BODY_BYTES) {
    return {
      ok: false,
      error: apiError('invalid-request', 'The transit content request is too large.'),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: apiError('invalid-request', 'The transit content request is not valid JSON.'),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: apiError('invalid-request', 'The transit content request must be an object.'),
    };
  }
  const envelope = parsed as Record<string, unknown>;
  // The version gates the whole envelope, so it is read before anything inside
  // it: a future version may spell these fields differently.
  if (envelope.version !== 'transit-network-v1') {
    return {
      ok: false,
      error: apiError('unsupported-version', 'The request names an unsupported API version.'),
    };
  }
  const value = envelope.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: apiError('invalid-request', 'The transit content request carries no value object.'),
    };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function respondWithFailure(c: Context<TransitApiEnv>, error: TransitApiError): Response {
  return c.json(failure(error), transitApiErrorStatus(error));
}

function describeContentHandler(dependencies: TransitApiDependencies): Handler<TransitApiEnv> {
  return async (c) => {
    const body = await boundedRequest(c);
    if (!body.ok) return respondWithFailure(c, body.error);

    let reference: ContentRef;
    try {
      reference = parseContentRef(body.value.reference);
    } catch (error) {
      return respondWithFailure(c, apiError('invalid-request', (error as Error).message));
    }

    try {
      const { provider } = await providerForReference(c.env.DB, dependencies, reference);
      return c.json(success(await provider.describe(reference)));
    } catch (error) {
      return respondWithFailure(c, wireError(error));
    }
  };
}

function networkPageHandler(dependencies: TransitApiDependencies): Handler<TransitApiEnv> {
  return async (c) => {
    const body = await boundedRequest(c);
    if (!body.ok) return respondWithFailure(c, body.error);

    let content: ResolvedContentRef;
    let query;
    try {
      content = parseResolvedContentRef(body.value.content);
      query = parseNetworkQuery(body.value.query);
    } catch (error) {
      return respondWithFailure(c, apiError('invalid-request', (error as Error).message));
    }

    try {
      const { provider } = await providerForResolvedReference(c.env.DB, dependencies, content);
      return c.json(success(await provider.resolve(content, query)));
    } catch (error) {
      return respondWithFailure(c, wireError(error));
    }
  };
}

/** The transit content resources. Search and entity-detail pages arrive with
 * Dataset delivery; a System host reads them out of the network page it
 * already holds. */
export function createTransitApi(dependencies: TransitApiDependencies): Hono<TransitApiEnv> {
  const transit = new Hono<TransitApiEnv>();
  transit.post('/content-descriptions', describeContentHandler(dependencies));
  transit.post('/network-pages', networkPageHandler(dependencies));
  return transit;
}
