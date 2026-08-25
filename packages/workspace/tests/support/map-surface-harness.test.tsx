import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createMapViewStore,
  createSelectionController,
  type MapDriver,
  type MapDriverAttachOptions,
  type MapDriverAttachment,
  type MapRuntime,
} from '@transitmapper/map';
import { vi, type Mock } from 'vitest';
import { MapSurface, type MapSurfaceProps } from '../../src/map-surface';

export type TestTheme = 'light' | 'dark';

export interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

export interface RuntimeHarness {
  runtime: MapRuntime<TestTheme>;
  reportError: Mock<(error: unknown) => void>;
  requestTheme: Mock<(theme: TestTheme) => Promise<void>>;
  dispose: Mock<() => void>;
}

export interface TestDriver extends MapDriver {
  attachSpy: Mock<(options: MapDriverAttachOptions) => Promise<MapDriverAttachment>>;
}

export interface TestAttachment extends MapDriverAttachment {
  disposeSpy: Mock<() => void>;
}

export interface MountedSurface {
  root: Root;
  host: HTMLDivElement;
  render(props: MapSurfaceProps<TestTheme>): Promise<void>;
  unmount(): Promise<void>;
}

export function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function createViewStore() {
  return createMapViewStore({
    schemaVersion: 1,
    camera: { center: [-115.17, 36.17], zoom: 10 },
    representationId: 'network',
    filters: {},
  });
}

export function createAttachment(onDispose: () => void = () => {}): TestAttachment {
  const disposeSpy = vi.fn(onDispose);
  return {
    resolveFeature: () => Promise.resolve(null),
    dispose: () => disposeSpy(),
    disposeSpy,
  };
}

export function createDriver(
  id: string,
  attach: (options: MapDriverAttachOptions) => Promise<MapDriverAttachment>,
): TestDriver {
  const attachSpy = vi.fn(attach);
  return {
    definition: {
      id,
      title: id,
      representations: [],
      filters: [],
      attribution: [],
    },
    attach: (options) => attachSpy(options),
    attachSpy,
  };
}

export function createRuntimeHarness(onDispose: () => void = () => {}): RuntimeHarness {
  const map = {} as MapRuntime<TestTheme>['map'];
  const reportError = vi.fn<(error: unknown) => void>();
  const requestTheme = vi.fn<(theme: TestTheme) => Promise<void>>(() => Promise.resolve());
  const dispose = vi.fn(onDispose);
  return {
    reportError,
    requestTheme,
    dispose,
    runtime: {
      host: { map, reportError },
      map,
      milestones: {
        contentCommitted: vi.fn<() => void>(),
        interactive: vi.fn<() => void>(),
      },
      requestTheme,
      flushTheme: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      refreshPadding: vi.fn<() => void>(),
      dispose,
    },
  };
}

export function takeNext<Value>(values: Value[]): Value {
  const next = values.shift();
  if (next === undefined) throw new Error('Test runtime queue is empty');
  return next;
}

export function baseProps(
  driver: MapDriver,
  createRuntime: MapSurfaceProps<TestTheme>['createRuntime'],
): MapSurfaceProps<TestTheme> {
  return {
    driver,
    contentIdentity: 'document-a',
    viewStore: createViewStore(),
    selection: createSelectionController(),
    theme: 'light',
    createRuntime,
  };
}

export async function mountSurface(props: MapSurfaceProps<TestTheme>): Promise<MountedSurface> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (nextProps: MapSurfaceProps<TestTheme>) => {
    await act(async () => {
      root.render(<MapSurface {...nextProps} />);
      await Promise.resolve();
    });
  };
  await render(props);
  return {
    root,
    host,
    render,
    async unmount() {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
    },
  };
}
