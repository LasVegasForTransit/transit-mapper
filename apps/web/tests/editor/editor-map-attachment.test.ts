// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  LYR_GESTURE_POINT,
  LYR_STATIONS,
  SRC_PATTERN_OVERLAY,
  SRC_PATTERN_OVERLAY_ARROWS,
  SRC_PATTERN_OVERLAY_TERMINI,
} from '@transitmapper/renderer/layers';
import type { PatternOverlayFeatures } from '@transitmapper/renderer/projection';
import { aService, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  attachEditorMap,
  type AttachEditorMapOptions,
} from '../../src/editor/editor-map-attachment';
import {
  createEditorMapAttachmentHarness as createHarness,
  stopDragEvent,
} from '../support/editor-map-attachment-harness.test';

describe('the editor map attachment', () => {
  it('installs its gesture layers before it accepts editor input', () => {
    const harness = createHarness();
    harness.map.removeLayer(LYR_GESTURE_POINT);

    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );

    expect(harness.map.getLayer(LYR_GESTURE_POINT)).toBeDefined();
    attachment.dispose();
  });

  it('attaches one live session and disposes every owned extension once', () => {
    const harness = createHarness();
    const signal = new AbortController();
    const attachment = attachEditorMap(harness.session, harness.options, signal.signal);

    expect(harness.map.listenerCount()).toBeGreaterThan(0);
    expect(harness.accepted.size).toBe(1);

    attachment.dispose();
    attachment.dispose();
    signal.abort();

    expect(harness.map.listenerCount()).toBe(0);
    expect(harness.accepted.size).toBe(0);
    expect(harness.detachSimulation).toHaveBeenCalledOnce();
    expect(harness.detachInstrumentation).toHaveBeenCalledOnce();
    expect(harness.worker.dispose).toHaveBeenCalledOnce();
  });

  it('updates editor sources without scheduling committed document projection', async () => {
    const harness = createHarness();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );

    frames.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.worker.project).toHaveBeenCalledOnce();
    expect(harness.renderer.updateEditorScene).toHaveBeenCalledOnce();
    expect(harness.scheduleProjection).not.toHaveBeenCalled();
    attachment.dispose();
    requestFrame.mockRestore();
  });

  it('publishes an opened Pattern only to the editor overlay sources', async () => {
    const harness = createHarness();
    const service = aService('service-a', []);
    const system = aSystem({ services: [service] });
    harness.options.document.store.commands.document.setSystem(system);
    harness.options.document.store.commands.selection.select({ kind: 'service', id: service.id });
    harness.options.document.store.commands.selection.setActivePattern(service.path.id);
    const overlay: PatternOverlayFeatures = {
      path: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: [[-115.2, 36.1]] },
          },
        ],
      },
      arrows: { type: 'FeatureCollection' as const, features: [] },
      termini: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: [-115.2, 36.1] },
          },
        ],
      },
    };
    harness.worker.projectPatternOverlay.mockResolvedValue(overlay);
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );

    frames.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.worker.projectPatternOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: service.id, patternId: service.path.id }),
      expect.any(AbortSignal),
    );
    expect(harness.map.getSource(SRC_PATTERN_OVERLAY).setData).toHaveBeenCalledWith(overlay.path);
    expect(harness.map.getSource(SRC_PATTERN_OVERLAY_ARROWS).setData).toHaveBeenCalledWith(
      overlay.arrows,
    );
    expect(harness.map.getSource(SRC_PATTERN_OVERLAY_TERMINI).setData).toHaveBeenCalledWith(
      overlay.termini,
    );
    attachment.dispose();
    requestFrame.mockRestore();
  });

  it('rolls back an active drag on disposal and leaves history usable', () => {
    const harness = createHarness();
    const stopId = harness.options.document.store.commands.stops.addStop([-115.2, 36.1]);
    harness.map.setRenderedFeatures([
      {
        id: stopId,
        source: 'tm-stations-a',
        layer: { id: LYR_STATIONS, type: 'circle', source: 'tm-stations-a' },
        properties: { id: stopId, kind: 'stop' },
        geometry: { type: 'Point', coordinates: [-115.2, 36.1] },
      },
    ]);
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const original = harness.options.document.store.getState().system.stops[0].coord;
    const first = attachEditorMap(harness.session, harness.options, new AbortController().signal);

    harness.map.fire('mousedown', stopDragEvent(100));
    harness.map.fire('mousemove', stopDragEvent(150));
    frames.splice(0).forEach((frame) => frame(0));
    expect(harness.options.document.store.getState().system.stops[0].coord).not.toEqual(original);

    first.dispose();
    expect(harness.options.document.store.getState().system.stops[0].coord).toEqual(original);

    const second = attachEditorMap(harness.session, harness.options, new AbortController().signal);
    harness.map.fire('mousedown', stopDragEvent(100));
    harness.map.fire('mousemove', stopDragEvent(160));
    harness.map.fire('mouseup', stopDragEvent(160));
    const committed = harness.options.document.store.getState().system.stops[0].coord;
    expect(committed).not.toEqual(original);

    harness.options.document.store.commands.history.undo();
    expect(harness.options.document.store.getState().system.stops[0].coord).toEqual(original);
    second.dispose();
    requestFrame.mockRestore();
  });

  it('does not publish a held gesture when its attachment is disposed', () => {
    const harness = createHarness();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const stopId = harness.options.document.store.commands.stops.addStop([-115.2, 36.1]);
    const original = harness.options.document.store.getState().system.stops[0].coord;
    harness.map.setRenderedFeatures([
      {
        id: stopId,
        source: 'tm-stations-a',
        layer: { id: LYR_STATIONS, type: 'circle', source: 'tm-stations-a' },
        properties: { id: stopId, kind: 'stop' },
        geometry: { type: 'Point', coordinates: original },
      },
    ]);
    const published: unknown[] = [];
    const unsubscribe = harness.options.document.source.subscribe((snapshot) => {
      published.push(snapshot.system);
    });
    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );

    harness.map.fire('mousedown', stopDragEvent(100));
    harness.map.fire('mousemove', stopDragEvent(160));
    frames.splice(0).forEach((frame) => frame(0));
    expect(harness.options.document.store.getState().system.stops[0].coord).not.toEqual(original);
    attachment.dispose();

    expect(harness.options.document.store.getState().system.stops[0].coord).toEqual(original);
    expect(published).toEqual([]);
    unsubscribe();
    requestFrame.mockRestore();
  });

  it('continues cleanup when extensions throw', () => {
    const harness = createHarness();
    harness.options.simulation.attach = () => () => {
      harness.detachSimulation();
      throw new Error('simulation cleanup');
    };
    const options: AttachEditorMapOptions = {
      ...harness.options,
      instrumentation: {
        attach: () => ({
          dispose() {
            harness.detachInstrumentation();
            throw new Error('instrumentation cleanup');
          },
        }),
      },
    };
    harness.worker.dispose.mockImplementation(() => {
      throw new Error('worker cleanup');
    });
    const attachment = attachEditorMap(harness.session, options, new AbortController().signal);

    attachment.dispose();

    expect(harness.detachInstrumentation).toHaveBeenCalledOnce();
    expect(harness.detachSimulation).toHaveBeenCalledOnce();
    expect(harness.worker.dispose).toHaveBeenCalledOnce();
    expect(harness.map.listenerCount()).toBe(0);
    expect(harness.reportError).toHaveBeenCalledTimes(3);
  });

  it('contains throwing optional setup ports and keeps the core attachment live', () => {
    const harness = createHarness();
    harness.options.simulation.attach = () => {
      throw new Error('simulation setup');
    };
    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );

    expect(harness.reportError).toHaveBeenCalledOnce();
    expect(harness.map.listenerCount()).toBeGreaterThan(0);
    attachment.dispose();
    expect(harness.map.listenerCount()).toBe(0);
  });

  it('does not treat camera publication as an editor view change', () => {
    const harness = createHarness();
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame');
    const attachment = attachEditorMap(
      harness.session,
      harness.options,
      new AbortController().signal,
    );
    harness.options.document.store.commands.selection.armTerminus({
      serviceId: 'service',
      patternId: 'pattern',
      side: 'end',
      position: {
        patternId: 'pattern',
        run: 'outbound',
        legIndex: 0,
        wayId: 'way',
        t: 1,
        distanceMeters: 1,
      },
    });
    const armedTerminus = harness.options.document.store.getState().armedTerminus;
    harness.notifySimulation.mockClear();
    requestFrame.mockClear();

    harness.viewStore.setCamera({ center: [-115.1, 36.2], zoom: 13 });

    expect(harness.options.document.store.getState().armedTerminus).toBe(armedTerminus);
    expect(harness.notifySimulation).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
    attachment.dispose();
    requestFrame.mockRestore();
  });

  it('rolls back the projection worker when projection listener setup throws', () => {
    const harness = createHarness();
    harness.map.on = () => {
      throw new Error('projection setup');
    };

    expect(() =>
      attachEditorMap(harness.session, harness.options, new AbortController().signal),
    ).toThrow('projection setup');

    expect(harness.worker.dispose).toHaveBeenCalledOnce();
    expect(harness.map.listenerCount()).toBe(0);
  });

  it('rolls back projection when gesture construction throws', () => {
    const harness = createHarness();
    const document = {
      store: harness.options.document.store,
      get source(): never {
        throw new Error('gesture setup');
      },
    };
    const options: AttachEditorMapOptions = { ...harness.options, document };

    expect(() => attachEditorMap(harness.session, options, new AbortController().signal)).toThrow(
      'gesture setup',
    );

    expect(harness.worker.dispose).toHaveBeenCalledOnce();
    expect(harness.map.listenerCount()).toBe(0);
  });

  it('rolls back window and map listeners when keyboard setup throws', () => {
    const harness = createHarness();
    const windowListeners = new Set<EventListenerOrEventListenerObject>();
    const addWindowListener = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((_type, listener) => {
        windowListeners.add(listener);
      });
    const removeWindowListener = vi
      .spyOn(window, 'removeEventListener')
      .mockImplementation((_type, listener) => {
        windowListeners.delete(listener);
      });
    harness.options.interactions.attachKeyboard = () => {
      throw new Error('keyboard setup');
    };

    expect(() =>
      attachEditorMap(harness.session, harness.options, new AbortController().signal),
    ).toThrow('keyboard setup');

    expect(windowListeners.size).toBe(0);
    expect(harness.map.listenerCount()).toBe(0);
    expect(harness.worker.dispose).toHaveBeenCalledOnce();
    addWindowListener.mockRestore();
    removeWindowListener.mockRestore();
  });

  it('releases resources returned after a synchronous keyboard abort', () => {
    const harness = createHarness();
    const signal = new AbortController();
    const detachKeyboard = vi.fn();
    harness.options.interactions.attachKeyboard = () => {
      signal.abort();
      return detachKeyboard;
    };

    const attachment = attachEditorMap(harness.session, harness.options, signal.signal);

    expect(signal.signal.aborted).toBe(true);
    expect(detachKeyboard).toHaveBeenCalledOnce();
    expect(harness.map.listenerCount()).toBe(0);
    expect(harness.worker.dispose).toHaveBeenCalledOnce();
    expect(harness.detachSimulation).not.toHaveBeenCalled();
    attachment.dispose();
    expect(detachKeyboard).toHaveBeenCalledOnce();
  });

  it('does not attach later extensions after simulation aborts setup', () => {
    const harness = createHarness();
    const signal = new AbortController();
    const detachSimulation = vi.fn();
    const attachInstrumentation = vi.fn();
    harness.options.simulation.attach = () => {
      signal.abort();
      return detachSimulation;
    };
    const options: AttachEditorMapOptions = {
      ...harness.options,
      instrumentation: { attach: attachInstrumentation },
    };

    attachEditorMap(harness.session, options, signal.signal);

    expect(detachSimulation).toHaveBeenCalledOnce();
    expect(attachInstrumentation).not.toHaveBeenCalled();
    expect(harness.map.listenerCount()).toBe(0);
    expect(harness.worker.dispose).toHaveBeenCalledOnce();
  });
});
