// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import {
  createSelectionController,
  type MapDriverAttachOptions,
  type MapDriverAttachment,
  type MapRuntime,
} from '@transitmapper/map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseProps,
  createAttachment,
  createDriver,
  createRuntimeHarness,
  createViewStore,
  deferred,
  mountSurface,
  takeNext,
  type TestTheme,
} from './support/map-surface-harness.test';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('MapSurface', () => {
  it('creates the runtime in its container and attaches the driver with fresh surface ports', async () => {
    const attachment = createAttachment();
    let attachOptions: MapDriverAttachOptions | undefined;
    const driver = createDriver('document', (options) => {
      attachOptions = options;
      return Promise.resolve(attachment);
    });
    const runtime = createRuntimeHarness();
    const createRuntime = vi.fn(() => runtime.runtime);
    const props = baseProps(driver, createRuntime);
    const mounted = await mountSurface(props);
    const surface = mounted.host.querySelector<HTMLElement>('.workspace-map-surface');

    expect(surface).not.toBeNull();
    expect(createRuntime).toHaveBeenCalledExactlyOnceWith({
      container: surface,
      viewStore: props.viewStore,
      initialTheme: 'light',
    });
    expect(attachOptions?.host).toBe(runtime.runtime.host);
    expect(attachOptions?.viewStore).toBe(props.viewStore);
    expect(attachOptions?.selection).toBe(props.selection);
    expect(attachOptions?.milestones).toBe(runtime.runtime.milestones);
    expect(attachOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(attachOptions?.signal.aborted).toBe(false);

    await mounted.unmount();
  });

  it('keeps the same container and runtime when the theme changes', async () => {
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const runtime = createRuntimeHarness();
    const createRuntime = vi.fn(() => runtime.runtime);
    const props = baseProps(driver, createRuntime);
    const mounted = await mountSurface(props);
    const surface = mounted.host.querySelector('.workspace-map-surface');

    await mounted.render({ ...props, theme: 'dark' });

    expect(mounted.host.querySelector('.workspace-map-surface')).toBe(surface);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(driver.attachSpy).toHaveBeenCalledTimes(1);
    expect(runtime.requestTheme).toHaveBeenCalledExactlyOnceWith('dark');
    expect(runtime.dispose).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it('replaces the runtime and aborts the old attachment when the driver changes', async () => {
    let firstSignal: AbortSignal | undefined;
    const firstAttachment = createAttachment();
    const secondAttachment = createAttachment();
    const firstDriver = createDriver('first', (options) => {
      firstSignal = options.signal;
      return Promise.resolve(firstAttachment);
    });
    const secondDriver = createDriver('second', () => Promise.resolve(secondAttachment));
    const firstRuntime = createRuntimeHarness();
    const secondRuntime = createRuntimeHarness();
    const runtimes = [firstRuntime.runtime, secondRuntime.runtime];
    const createRuntime = vi.fn(() => takeNext(runtimes));
    const props = baseProps(firstDriver, createRuntime);
    const mounted = await mountSurface(props);
    const surface = mounted.host.querySelector('.workspace-map-surface');

    await mounted.render({ ...props, driver: secondDriver });

    expect(mounted.host.querySelector('.workspace-map-surface')).toBe(surface);
    expect(firstSignal?.aborted).toBe(true);
    expect(firstAttachment.disposeSpy).toHaveBeenCalledOnce();
    expect(firstRuntime.dispose).toHaveBeenCalledOnce();
    expect(secondDriver.attachSpy).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledTimes(2);

    await mounted.unmount();
  });

  it('replaces the runtime when the content identity changes', async () => {
    const attachments = [createAttachment(), createAttachment()];
    const driver = createDriver('document', () => Promise.resolve(takeNext(attachments)));
    const firstRuntime = createRuntimeHarness();
    const secondRuntime = createRuntimeHarness();
    const runtimes = [firstRuntime.runtime, secondRuntime.runtime];
    const createRuntime = vi.fn(() => takeNext(runtimes));
    const props = baseProps(driver, createRuntime);
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, contentIdentity: 'document-b' });

    expect(firstRuntime.dispose).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(driver.attachSpy).toHaveBeenCalledTimes(2);

    await mounted.unmount();
  });

  it('replaces the runtime when an injected lifecycle owner changes', async () => {
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const firstHarness = createRuntimeHarness();
    const viewHarness = createRuntimeHarness();
    const selectionHarness = createRuntimeHarness();
    const factoryHarness = createRuntimeHarness();
    const firstFactory = vi.fn(() => firstHarness.runtime);
    const secondFactory = vi.fn(() => factoryHarness.runtime);
    const props = baseProps(driver, firstFactory);
    const mounted = await mountSurface(props);

    const secondViewStore = createViewStore();
    firstFactory.mockReturnValueOnce(viewHarness.runtime);
    await mounted.render({ ...props, viewStore: secondViewStore });
    const secondSelection = createSelectionController();
    firstFactory.mockReturnValueOnce(selectionHarness.runtime);
    await mounted.render({ ...props, viewStore: secondViewStore, selection: secondSelection });
    await mounted.render({
      ...props,
      viewStore: secondViewStore,
      selection: secondSelection,
      createRuntime: secondFactory,
    });

    expect(driver.attachSpy).toHaveBeenCalledTimes(4);
    expect(firstHarness.dispose).toHaveBeenCalledOnce();
    expect(viewHarness.dispose).toHaveBeenCalledOnce();
    expect(selectionHarness.dispose).toHaveBeenCalledOnce();
    expect(secondFactory).toHaveBeenCalledOnce();

    await mounted.unmount();
  });

  it('uses a replacement runtime callback without remounting for that callback alone', async () => {
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const firstRuntime = createRuntimeHarness();
    const secondRuntime = createRuntimeHarness();
    const runtimes = [firstRuntime.runtime, secondRuntime.runtime];
    const createRuntime = vi.fn(() => takeNext(runtimes));
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const props = {
      ...baseProps(driver, createRuntime),
      onRuntimeChange: firstCallback,
    };
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, onRuntimeChange: secondCallback });

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(firstRuntime.dispose).not.toHaveBeenCalled();
    expect(secondCallback).not.toHaveBeenCalled();

    await mounted.render({
      ...props,
      contentIdentity: 'document-b',
      onRuntimeChange: secondCallback,
    });

    expect(secondCallback.mock.calls).toEqual([[null], [secondRuntime.runtime]]);

    await mounted.unmount();
  });

  it('disposes a stale attachment when it resolves after replacement', async () => {
    const stale = deferred<MapDriverAttachment>();
    const staleAttachment = createAttachment();
    const currentAttachment = createAttachment();
    const firstDriver = createDriver('first', () => stale.promise);
    const secondDriver = createDriver('second', () => Promise.resolve(currentAttachment));
    const firstRuntime = createRuntimeHarness();
    const secondRuntime = createRuntimeHarness();
    const runtimes = [firstRuntime.runtime, secondRuntime.runtime];
    const createRuntime = vi.fn(() => takeNext(runtimes));
    const onRuntimeChange = vi.fn();
    const props = { ...baseProps(firstDriver, createRuntime), onRuntimeChange };
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, driver: secondDriver });
    stale.resolve(staleAttachment);
    await act(() => stale.promise);

    expect(staleAttachment.disposeSpy).toHaveBeenCalledOnce();
    expect(onRuntimeChange.mock.calls).toEqual([
      [firstRuntime.runtime],
      [null],
      [secondRuntime.runtime],
    ]);

    await mounted.unmount();
  });

  it('reports a current attachment rejection through the runtime host', async () => {
    const failure = new Error('driver attach failed');
    const driver = createDriver('document', () => Promise.reject(failure));
    const runtime = createRuntimeHarness();
    const mounted = await mountSurface(baseProps(driver, () => runtime.runtime));
    await act(() => Promise.resolve());

    expect(runtime.reportError).toHaveBeenCalledExactlyOnceWith(failure);

    await mounted.unmount();
  });

  it('reports a current theme rejection without remounting the runtime', async () => {
    const failure = new Error('theme failed');
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const runtime = createRuntimeHarness();
    runtime.requestTheme.mockRejectedValueOnce(failure);
    const createRuntime = vi.fn(() => runtime.runtime);
    const props = baseProps(driver, createRuntime);
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, theme: 'dark' });
    await act(() => Promise.resolve());

    expect(runtime.reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(createRuntime).toHaveBeenCalledOnce();

    await mounted.unmount();
  });

  it('contains a runtime reporter failure from a rejected attachment', async () => {
    const failure = new Error('attach failed');
    const driver = createDriver('document', () => Promise.reject(failure));
    const runtime = createRuntimeHarness();
    runtime.reportError.mockImplementation(() => {
      throw new Error('reporter failed');
    });

    const mounted = await mountSurface(baseProps(driver, () => runtime.runtime));
    await act(() => Promise.resolve());

    expect(runtime.reportError).toHaveBeenCalledExactlyOnceWith(failure);

    await mounted.unmount();
  });

  it('contains the mounted runtime callback before attaching the driver', async () => {
    const callbackFailure = new Error('runtime callback failed');
    const attachment = createAttachment();
    const driver = createDriver('document', () => Promise.resolve(attachment));
    const runtime = createRuntimeHarness();
    const onRuntimeChange = vi.fn(() => {
      throw callbackFailure;
    });

    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      onRuntimeChange,
    });

    expect(driver.attachSpy).toHaveBeenCalledOnce();
    expect(runtime.reportError).toHaveBeenCalledExactlyOnceWith(callbackFailure);

    await mounted.unmount();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('ignores a rejection from an attachment that replacement aborted', async () => {
    const pending = deferred<MapDriverAttachment>();
    const firstDriver = createDriver('first', () => pending.promise);
    const secondDriver = createDriver('second', () => Promise.resolve(createAttachment()));
    const firstRuntime = createRuntimeHarness();
    const secondRuntime = createRuntimeHarness();
    const runtimes = [firstRuntime.runtime, secondRuntime.runtime];
    const createRuntime = vi.fn(() => takeNext(runtimes));
    const props = baseProps(firstDriver, createRuntime);
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, driver: secondDriver });
    pending.reject(new Error('late failure'));
    await act(() => pending.promise.catch(() => {}));

    expect(firstRuntime.reportError).not.toHaveBeenCalled();
    expect(secondRuntime.reportError).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it('cleans up in abort, attachment, callback, and runtime order', async () => {
    const events: string[] = [];
    const attachment = createAttachment(() => events.push('attachment'));
    const driver = createDriver('document', (options) => {
      options.signal.addEventListener('abort', () => events.push('abort'));
      return Promise.resolve(attachment);
    });
    const runtime = createRuntimeHarness(() => events.push('runtime'));
    const onRuntimeChange = vi.fn((next: MapRuntime<TestTheme> | null) => {
      if (next === null) events.push('runtime-null');
    });
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      onRuntimeChange,
    });

    await mounted.unmount();

    expect(events).toEqual(['abort', 'attachment', 'runtime-null', 'runtime']);
  });

  it('continues cleanup when attachment disposal and the null callback throw', async () => {
    const events: string[] = [];
    const attachmentFailure = new Error('attachment cleanup failed');
    const callbackFailure = new Error('callback cleanup failed');
    const attachment = createAttachment(() => {
      events.push('attachment');
      throw attachmentFailure;
    });
    const driver = createDriver('document', (options) => {
      options.signal.addEventListener('abort', () => events.push('abort'));
      return Promise.resolve(attachment);
    });
    const runtime = createRuntimeHarness(() => events.push('runtime'));
    const onRuntimeChange = vi.fn((next: MapRuntime<TestTheme> | null) => {
      if (next !== null) return;
      events.push('runtime-null');
      throw callbackFailure;
    });
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      onRuntimeChange,
    });

    await mounted.unmount();

    expect(events).toEqual(['abort', 'attachment', 'runtime-null', 'runtime']);
    expect(runtime.reportError.mock.calls).toEqual([[attachmentFailure], [callbackFailure]]);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('disposes each attached resource exactly once on unmount', async () => {
    const attachment = createAttachment();
    let signal: AbortSignal | undefined;
    const driver = createDriver('document', (options) => {
      signal = options.signal;
      return Promise.resolve(attachment);
    });
    const runtime = createRuntimeHarness();
    const onRuntimeChange = vi.fn();
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      onRuntimeChange,
    });

    await mounted.unmount();

    expect(signal?.aborted).toBe(true);
    expect(attachment.disposeSpy).toHaveBeenCalledOnce();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(onRuntimeChange.mock.calls.filter(([value]) => value === null)).toHaveLength(1);
  });

  it('owns full-surface geometry and preserves an injected class name', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/workbench.css'), 'utf8');
    document.head.innerHTML = `<style>${css}</style>`;
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const runtime = createRuntimeHarness();
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      className: 'host-map',
    });
    const surface = mounted.host.querySelector<HTMLElement>('.workspace-map-surface');

    expect(surface?.className).toBe('workspace-map-surface host-map');
    if (surface === null) throw new Error('Expected MapSurface container');
    expect(getComputedStyle(surface).position).toBe('absolute');
    expect(getComputedStyle(surface).inset).toBe('0px');
    expect(getComputedStyle(surface).overflow).toBe('hidden');
    expect(getComputedStyle(surface).touchAction).toBe('none');

    await mounted.unmount();
  });
});
