import {
  serializeCreateViewRequest,
  serializeUpdateViewRequest,
  type CreateViewRequest,
  type CreateViewResponse,
  type GetViewResponse,
  type UpdateViewRequest,
} from '@transitmapper/views';
import { fetchWithTimeout, type FetchWithTimeoutOptions } from '../network/fetchWithTimeout';

export type PublishedViewRequestOptions = FetchWithTimeoutOptions;

interface WorkerErrorResponse {
  error?: unknown;
}

async function viewRequestError(response: Response, action: string): Promise<Error> {
  let detail = response.statusText;
  try {
    const payload = (await response.json()) as WorkerErrorResponse;
    if (typeof payload.error === 'string' && payload.error.length > 0) detail = payload.error;
  } catch {
    // A proxy can replace the Worker's JSON response with plain text. The
    // status still tells the caller which request failed.
  }
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`${action} (${response.status})${suffix}`);
}

export async function createPublishedView(
  request: CreateViewRequest,
  options: PublishedViewRequestOptions = {},
): Promise<CreateViewResponse> {
  const serialized = serializeCreateViewRequest(request);
  const response = await fetchWithTimeout(
    '/api/v1/views',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serialized.body,
    },
    options,
  );
  if (!response.ok) throw await viewRequestError(response, 'Could not publish the View');
  const payload: unknown = await response.json();
  return payload as CreateViewResponse;
}

export async function fetchPublishedView(
  id: string,
  options: PublishedViewRequestOptions = {},
): Promise<GetViewResponse> {
  const response = await fetchWithTimeout(`/api/v1/views/${encodeURIComponent(id)}`, {}, options);
  if (!response.ok) throw await viewRequestError(response, 'Could not load the View');
  const payload: unknown = await response.json();
  return payload as GetViewResponse;
}

export async function updatePublishedView(
  id: string,
  editToken: string,
  request: UpdateViewRequest,
  options: PublishedViewRequestOptions = {},
): Promise<GetViewResponse> {
  const serialized = serializeUpdateViewRequest(request);
  const response = await fetchWithTimeout(
    `/api/v1/views/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-edit-token': editToken },
      body: serialized.body,
    },
    options,
  );
  if (!response.ok) throw await viewRequestError(response, 'Could not update the View');
  const payload: unknown = await response.json();
  return payload as GetViewResponse;
}

export async function deletePublishedView(
  id: string,
  editToken: string,
  options: PublishedViewRequestOptions = {},
): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/v1/views/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'x-edit-token': editToken },
    },
    options,
  );
  if (response.status === 404) return;
  if (!response.ok) throw await viewRequestError(response, 'Could not delete the View');
}
