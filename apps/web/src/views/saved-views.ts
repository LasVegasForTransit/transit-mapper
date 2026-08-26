import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapViewStore, SelectionController } from '@transitmapper/map';
import type {
  CreateViewRequest,
  CreateViewResponse,
  GetViewResponse,
  MapViewStateV1,
  UpdateViewRequest,
} from '@transitmapper/views';
import type { LocalViewLibrary, LocalViewRecord } from './local-view-library';

interface RequestOptions {
  signal?: AbortSignal;
}

interface SharedSystemResource {
  id: string;
  url: string;
}

export type PublishSystem = (
  system: TransitSystem,
  options?: RequestOptions,
) => Promise<SharedSystemResource>;

export type CreatePublication = (
  request: CreateViewRequest,
  options?: RequestOptions,
) => Promise<CreateViewResponse>;

export type UpdatePublication = (
  id: string,
  editToken: string,
  request: UpdateViewRequest,
  options?: RequestOptions,
) => Promise<GetViewResponse>;

export type DeletePublication = (
  id: string,
  editToken: string,
  options?: RequestOptions,
) => Promise<void>;

export interface SaveCurrentViewOptions {
  documentId: string;
  title: string;
  viewStore: MapViewStore;
  selection: SelectionController;
  library: LocalViewLibrary;
  createId?: () => string;
  now?: () => number;
}

export interface RenameSavedViewOptions {
  view: LocalViewRecord;
  title: string;
  library: LocalViewLibrary;
  updatePublication: UpdatePublication;
  now?: () => number;
  signal?: AbortSignal;
}

export interface RenameSavedViewResult {
  view: LocalViewRecord;
  publicationError?: Error;
}

export interface PublishSavedViewOptions {
  view: LocalViewRecord;
  system: TransitSystem;
  library: LocalViewLibrary;
  publishSystem: PublishSystem;
  createPublication: CreatePublication;
  updatePublication: UpdatePublication;
  now?: () => number;
  signal?: AbortSignal;
}

export interface DeleteSavedViewOptions {
  view: LocalViewRecord;
  library: LocalViewLibrary;
  deletePublication: DeletePublication;
  signal?: AbortSignal;
}

function currentState(viewStore: MapViewStore, selection: SelectionController): MapViewStateV1 {
  const presentation = viewStore.getSnapshot();
  const selected = selection.getSnapshot();
  return selected === undefined ? presentation : { ...presentation, selection: selected };
}

function requireTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new TypeError('A saved view requires a name.');
  return title;
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error('The public View could not be updated.');
}

export function nextSavedViewTitle(views: readonly LocalViewRecord[]): string {
  const titles = new Set(views.map((view) => view.title.trim()));
  let number = 1;
  while (titles.has(`View ${number}`)) number += 1;
  return `View ${number}`;
}

export async function saveCurrentView(options: SaveCurrentViewOptions): Promise<LocalViewRecord> {
  const timestamp = (options.now ?? Date.now)();
  const view: LocalViewRecord = {
    documentId: options.documentId,
    id: (options.createId ?? crypto.randomUUID)(),
    title: requireTitle(options.title),
    state: currentState(options.viewStore, options.selection),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await options.library.put(view);
  return view;
}

export function restoreSavedView(
  view: LocalViewRecord,
  viewStore: MapViewStore,
  selection: SelectionController,
): void {
  const { selection: selected, ...presentation } = view.state;
  viewStore.replace(presentation);
  selection.select(selected);
}

export async function renameSavedView(
  options: RenameSavedViewOptions,
): Promise<RenameSavedViewResult> {
  const view: LocalViewRecord = {
    ...options.view,
    title: requireTitle(options.title),
    updatedAt: (options.now ?? Date.now)(),
  };
  await options.library.put(view);
  if (!view.publishedId || !view.editToken) return { view };

  try {
    await options.updatePublication(
      view.publishedId,
      view.editToken,
      { title: view.title },
      { signal: options.signal },
    );
    return { view };
  } catch (error) {
    return { view, publicationError: errorFrom(error) };
  }
}

function publicationRequest(view: LocalViewRecord, sharedSystemId: string): CreateViewRequest {
  const request: CreateViewRequest = {
    title: view.title,
    sharedSystemId,
    state: view.state,
  };
  if (view.description !== undefined) request.description = view.description;
  return request;
}

export async function publishSavedView(options: PublishSavedViewOptions): Promise<LocalViewRecord> {
  const requestOptions = { signal: options.signal };
  const camera = options.view.state.camera;
  const sharedSystem = await options.publishSystem(
    {
      ...options.system,
      viewport: { center: [camera.center[0], camera.center[1]], zoom: camera.zoom },
    },
    requestOptions,
  );
  const existingPublishedId = options.view.publishedId;
  const existingEditToken = options.view.editToken;

  let publishedId: string;
  let editToken: string;
  let sharedSystemId: string;
  if (
    existingPublishedId !== undefined &&
    existingEditToken !== undefined &&
    options.view.sharedSystemId === sharedSystem.id
  ) {
    const response = await options.updatePublication(
      existingPublishedId,
      existingEditToken,
      {
        title: options.view.title,
        description: options.view.description ?? null,
        state: options.view.state,
      },
      requestOptions,
    );
    publishedId = response.view.id;
    sharedSystemId = response.view.map.id;
    editToken = existingEditToken;
  } else {
    const response = await options.createPublication(
      publicationRequest(options.view, sharedSystem.id),
      requestOptions,
    );
    publishedId = response.view.id;
    sharedSystemId = response.view.map.id;
    editToken = response.editToken;
  }

  const view: LocalViewRecord = {
    ...options.view,
    publishedId,
    sharedSystemId,
    editToken,
    updatedAt: (options.now ?? Date.now)(),
  };
  await options.library.put(view);
  return view;
}

export async function deleteSavedView(options: DeleteSavedViewOptions): Promise<void> {
  if (options.view.publishedId && options.view.editToken) {
    await options.deletePublication(options.view.publishedId, options.view.editToken, {
      signal: options.signal,
    });
  }
  await options.library.delete(options.view.documentId, options.view.id);
}
