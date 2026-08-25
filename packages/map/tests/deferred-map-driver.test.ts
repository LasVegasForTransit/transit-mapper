import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeferredMapDriver,
  type MapDefinition,
  type MapDriver,
  type MapDriverAttachment,
  type MapDriverAttachOptions,
  type MapFeatureDetails,
} from '../src';

interface DeferredValue<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): DeferredValue<Value> {
  let resolvePromise!: (value: Value) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const definition: MapDefinition = {
  id: 'test-map',
  title: 'Test map',
  representations: [],
  filters: [],
  attribution: [],
};

function attachOptions(
  signal: AbortSignal,
  reportError: MapDriverAttachOptions['host']['reportError'] = vi.fn(),
): MapDriverAttachOptions {
  return {
    host: {
      map: {} as MapLibreMap,
      reportError,
    },
    viewStore: {} as MapDriverAttachOptions['viewStore'],
    selection: {} as MapDriverAttachOptions['selection'],
    milestones: {} as MapDriverAttachOptions['milestones'],
    signal,
  };
}

interface ConcreteDriverHarness {
  driver: MapDriver;
  attachSpy: ReturnType<typeof vi.fn<MapDriver['attach']>>;
}

function concreteDriver(attach: MapDriver['attach']): ConcreteDriverHarness {
  const attachSpy = vi.fn(attach);
  return { driver: { definition, attach: attachSpy }, attachSpy };
}

interface AttachmentHarness {
  attachment: MapDriverAttachment;
  resolveFeatureSpy: ReturnType<typeof vi.fn<MapDriverAttachment['resolveFeature']>>;
  disposeSpy: ReturnType<typeof vi.fn<MapDriverAttachment['dispose']>>;
}

function attachment(): AttachmentHarness {
  const resolveFeatureSpy = vi.fn(() => Promise.resolve(null));
  const disposeSpy = vi.fn();
  return {
    attachment: { resolveFeature: resolveFeatureSpy, dispose: disposeSpy },
    resolveFeatureSpy,
    disposeSpy,
  };
}

describe('deferred map driver', () => {
  it('publishes its definition without loading the concrete driver', () => {
    const load = vi.fn(() =>
      Promise.resolve(concreteDriver(() => Promise.resolve(attachment().attachment)).driver),
    );
    const driver = createDeferredMapDriver({ definition, load });

    expect(driver.definition).toBe(definition);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads on attachment and forwards the surface ports unchanged', async () => {
    const expectedDetails: MapFeatureDetails = {
      reference: { source: 'document', kind: 'stop', id: 'one' },
      title: 'One',
      fields: [],
    };
    const attached = attachment();
    attached.resolveFeatureSpy.mockResolvedValue(expectedDetails);
    const concrete = concreteDriver(() => Promise.resolve(attached.attachment));
    const load = vi.fn(() => Promise.resolve(concrete.driver));
    const controller = new AbortController();
    const options = attachOptions(controller.signal);
    const driver = createDeferredMapDriver({ definition, load });

    const resolved = await driver.attach(options);
    const featureSignal = new AbortController().signal;

    await expect(resolved.resolveFeature(expectedDetails.reference, featureSignal)).resolves.toBe(
      expectedDetails,
    );
    expect(load).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(concrete.attachSpy).toHaveBeenCalledExactlyOnceWith(options);
    expect(attached.resolveFeatureSpy).toHaveBeenCalledExactlyOnceWith(
      expectedDetails.reference,
      featureSignal,
    );

    resolved.dispose();
    expect(attached.disposeSpy).toHaveBeenCalledOnce();
  });

  it('does not load when the attachment signal is already aborted', async () => {
    const load = vi.fn(() =>
      Promise.resolve(concreteDriver(() => Promise.resolve(attachment().attachment)).driver),
    );
    const controller = new AbortController();
    controller.abort();
    const driver = createDeferredMapDriver({ definition, load });

    const resolved = await driver.attach(attachOptions(controller.signal));

    expect(load).not.toHaveBeenCalled();
    await expect(
      resolved.resolveFeature(
        { source: 'document', kind: 'stop', id: 'one' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(() => resolved.dispose()).not.toThrow();
  });

  it('does not attach a driver that loads after the surface aborts', async () => {
    const pendingDriver = deferred<MapDriver>();
    const concrete = concreteDriver(() => Promise.resolve(attachment().attachment));
    const controller = new AbortController();
    const driver = createDeferredMapDriver({
      definition,
      load: () => pendingDriver.promise,
    });
    const pendingAttachment = driver.attach(attachOptions(controller.signal));

    controller.abort();
    pendingDriver.resolve(concrete.driver);
    const resolved = await pendingAttachment;

    expect(concrete.attachSpy).not.toHaveBeenCalled();
    await expect(
      resolved.resolveFeature(
        { source: 'document', kind: 'stop', id: 'one' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it('disposes an attachment that resolves after the surface aborts', async () => {
    const pendingConcreteAttachment = deferred<MapDriverAttachment>();
    const attached = attachment();
    const concrete = concreteDriver(() => pendingConcreteAttachment.promise);
    const controller = new AbortController();
    const driver = createDeferredMapDriver({
      definition,
      load: () => Promise.resolve(concrete.driver),
    });
    const pendingAttachment = driver.attach(attachOptions(controller.signal));
    await Promise.resolve();

    controller.abort();
    pendingConcreteAttachment.resolve(attached.attachment);
    const resolved = await pendingAttachment;

    expect(attached.disposeSpy).toHaveBeenCalledOnce();
    expect(resolved).not.toBe(attached.attachment);
    await expect(
      resolved.resolveFeature(
        { source: 'document', kind: 'stop', id: 'one' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it('reports but contains cleanup failures from an aborted late attachment', async () => {
    const cleanupFailure = new Error('cleanup failed');
    const pendingConcreteAttachment = deferred<MapDriverAttachment>();
    const attached = attachment();
    attached.disposeSpy.mockImplementation(() => {
      throw cleanupFailure;
    });
    const concrete = concreteDriver(() => pendingConcreteAttachment.promise);
    const controller = new AbortController();
    const reportError = vi.fn();
    const options = attachOptions(controller.signal, reportError);
    const driver = createDeferredMapDriver({
      definition,
      load: () => Promise.resolve(concrete.driver),
    });
    const pendingAttachment = driver.attach(options);
    await Promise.resolve();

    controller.abort();
    pendingConcreteAttachment.resolve(attached.attachment);

    await expect(pendingAttachment).resolves.toBeDefined();
    expect(reportError).toHaveBeenCalledExactlyOnceWith(cleanupFailure);
  });

  it('preserves concrete driver load and attachment failures', async () => {
    const loadFailure = new Error('load failed');
    const attachFailure = new Error('attach failed');
    const loadErrorDriver = createDeferredMapDriver({
      definition,
      load: () => Promise.reject(loadFailure),
    });
    const attachErrorDriver = createDeferredMapDriver({
      definition,
      load: () => Promise.resolve(concreteDriver(() => Promise.reject(attachFailure)).driver),
    });

    await expect(loadErrorDriver.attach(attachOptions(new AbortController().signal))).rejects.toBe(
      loadFailure,
    );
    await expect(
      attachErrorDriver.attach(attachOptions(new AbortController().signal)),
    ).rejects.toBe(attachFailure);
  });

  it('allows one deferred driver to attach to concurrent surfaces', async () => {
    const attachments = [attachment().attachment, attachment().attachment];
    const concrete = concreteDriver(() => {
      const next = attachments.shift();
      if (!next) throw new Error('No attachment remains');
      return Promise.resolve(next);
    });
    const driver = createDeferredMapDriver({
      definition,
      load: () => Promise.resolve(concrete.driver),
    });

    const [first, second] = await Promise.all([
      driver.attach(attachOptions(new AbortController().signal)),
      driver.attach(attachOptions(new AbortController().signal)),
    ]);

    expect(concrete.attachSpy).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});
