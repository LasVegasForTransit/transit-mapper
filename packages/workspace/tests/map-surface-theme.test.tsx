// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseProps,
  createAttachment,
  createDriver,
  createRuntimeHarness,
  deferred,
  mountSurface,
} from './support/map-surface-harness.test';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('MapSurface theme requests', () => {
  it('ignores an older theme rejection after a newer request starts on the same runtime', async () => {
    const olderRequest = deferred<undefined>();
    const driver = createDriver('document', () => Promise.resolve(createAttachment()));
    const runtime = createRuntimeHarness();
    runtime.requestTheme
      .mockImplementationOnce(() => olderRequest.promise)
      .mockImplementationOnce(() => Promise.resolve());
    const createRuntime = vi.fn(() => runtime.runtime);
    const props = baseProps(driver, createRuntime);
    const mounted = await mountSurface(props);

    await mounted.render({ ...props, theme: 'dark' });
    await mounted.render({ ...props, theme: 'light' });
    olderRequest.reject(new Error('superseded theme failed'));
    await act(() => olderRequest.promise.catch(() => {}));

    expect(runtime.requestTheme.mock.calls).toEqual([['dark'], ['light']]);
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(runtime.reportError).not.toHaveBeenCalled();

    await mounted.unmount();
  });
});
