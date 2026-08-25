// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleMapAttachmentAfterFirstPaint } from '../src/map-surface';
import {
  baseProps,
  createAttachment,
  createDriver,
  createRuntimeHarness,
  mountSurface,
} from './support/map-surface-harness.test';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('MapSurface attachment scheduling', () => {
  it('publishes the runtime before starting a deferred driver attachment', async () => {
    const events: string[] = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        events.push('scheduled');
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const driver = createDriver('document', () => {
      events.push('attached');
      return Promise.resolve(createAttachment());
    });
    const runtime = createRuntimeHarness();
    const mounted = await mountSurface({
      ...baseProps(driver, () => {
        events.push('created');
        return runtime.runtime;
      }),
      scheduleAttachment: scheduleMapAttachmentAfterFirstPaint,
      onRuntimeChange: () => events.push('published'),
    });

    expect(events).toEqual(['created', 'published', 'scheduled']);
    expect(driver.attachSpy).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(16);
      await Promise.resolve();
    });

    expect(events).toEqual(['created', 'published', 'scheduled', 'scheduled']);
    expect(driver.attachSpy).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(32);
      await Promise.resolve();
    });

    expect(events).toEqual(['created', 'published', 'scheduled', 'scheduled', 'attached']);

    await mounted.unmount();
  });

  it('cancels a deferred attachment before it can start', async () => {
    let runFrame: FrameRequestCallback | undefined;
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        runFrame = callback;
        return 23;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const runtime = createRuntimeHarness();
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      scheduleAttachment: scheduleMapAttachmentAfterFirstPaint,
    });

    await mounted.unmount();
    await act(async () => {
      runFrame?.(16);
      await Promise.resolve();
    });

    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(23);
    expect(driver.attachSpy).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a deferred attachment and runtime exactly once', async () => {
    let runFrame: FrameRequestCallback | undefined;
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        runFrame = callback;
        return 31;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const attachment = createAttachment();
    const driver = createDriver('document', () => Promise.resolve(attachment));
    const runtime = createRuntimeHarness();
    const mounted = await mountSurface({
      ...baseProps(driver, () => runtime.runtime),
      scheduleAttachment: scheduleMapAttachmentAfterFirstPaint,
    });

    await act(async () => {
      runFrame?.(16);
      await Promise.resolve();
      runFrame?.(32);
      await Promise.resolve();
    });
    await mounted.unmount();

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(attachment.disposeSpy).toHaveBeenCalledOnce();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
