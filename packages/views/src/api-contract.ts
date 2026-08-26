import type { MapViewStateV1, SavedViewV1 } from './contract';
import { MAX_NAMED_VIEW_JSON_BYTES, parseMapViewState, ViewParseError } from './parse';
import { utf8ByteLength } from './text-bytes';

export const MAX_VIEW_API_BODY_BYTES = MAX_NAMED_VIEW_JSON_BYTES;

export interface CreateViewRequest {
  title: string;
  description?: string;
  sharedSystemId: string;
  state: MapViewStateV1;
}

export interface UpdateViewRequest {
  title?: string;
  description?: string | null;
  state?: MapViewStateV1;
}

export interface GetViewResponse {
  view: SavedViewV1;
  createdAt: number;
  updatedAt: number;
}

export interface CreateViewResponse extends GetViewResponse {
  editToken: string;
}

export interface SerializedViewRequest<T> {
  value: T;
  body: string;
  byteLength: number;
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewParseError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    throw new ViewParseError(`${path} must contain between 1 and ${maximumLength} characters`);
  }
  return value;
}

function sharedSystemId(value: unknown): string {
  return boundedText(value, 'sharedSystemId', 256);
}

function publishedState(value: unknown): MapViewStateV1 {
  const state = parseMapViewState(value);
  if (state.selection?.source === 'local-document') {
    throw new ViewParseError('selection.source cannot be local-document');
  }
  return state;
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ViewParseError(message);
}

export function parseCreateViewRequest(value: unknown): CreateViewRequest {
  const input = recordAt(value, 'View creation request');
  assertAllowedFields(
    input,
    new Set(['title', 'description', 'sharedSystemId', 'state']),
    'View creation request contains an unknown field',
  );
  const parsed: CreateViewRequest = {
    title: boundedText(input.title, 'title', 120),
    sharedSystemId: sharedSystemId(input.sharedSystemId),
    state: publishedState(input.state),
  };
  if (input.description !== undefined) {
    parsed.description = boundedText(input.description, 'description', 500);
  }
  return parsed;
}

export function parseUpdateViewRequest(value: unknown): UpdateViewRequest {
  const input = recordAt(value, 'View update request');
  const allowed = new Set(['title', 'description', 'state']);
  assertAllowedFields(input, allowed, 'View update contains an immutable field');
  const parsed: UpdateViewRequest = {};
  if (input.title !== undefined) parsed.title = boundedText(input.title, 'title', 120);
  if (input.description === null) parsed.description = null;
  else if (input.description !== undefined) {
    parsed.description = boundedText(input.description, 'description', 500);
  }
  if (input.state !== undefined) parsed.state = publishedState(input.state);
  if (Object.keys(parsed).length === 0) {
    throw new ViewParseError('View update must change at least one field');
  }
  return parsed;
}

function parseJsonBody<T>(json: string, parse: (value: unknown) => T): T {
  if (utf8ByteLength(json) > MAX_VIEW_API_BODY_BYTES) {
    throw new ViewParseError('View request body may contain at most 32 KiB');
  }
  try {
    return parse(JSON.parse(json));
  } catch (error) {
    if (error instanceof ViewParseError) throw error;
    throw new ViewParseError('View request body must contain valid JSON');
  }
}

export function parseCreateViewRequestJson(json: string): CreateViewRequest {
  return parseJsonBody(json, parseCreateViewRequest);
}

export function parseUpdateViewRequestJson(json: string): UpdateViewRequest {
  return parseJsonBody(json, parseUpdateViewRequest);
}

function serializedRequest<T>(value: T): SerializedViewRequest<T> {
  const body = JSON.stringify(value);
  const byteLength = utf8ByteLength(body);
  if (byteLength > MAX_VIEW_API_BODY_BYTES) {
    throw new ViewParseError('View request body may contain at most 32 KiB');
  }
  return { value, body, byteLength };
}

export function serializeCreateViewRequest(
  value: CreateViewRequest,
): SerializedViewRequest<CreateViewRequest> {
  return serializedRequest(parseCreateViewRequest(value));
}

export function serializeUpdateViewRequest(
  value: UpdateViewRequest,
): SerializedViewRequest<UpdateViewRequest> {
  return serializedRequest(parseUpdateViewRequest(value));
}
