import { describe, expect, it } from 'vitest';
import {
  createInstallController,
  shouldRegisterInstallController,
  type InstallEnvironment,
} from './install';

interface MemoryStorage {
  values: Map<string, string>;
}

function createEnvironment(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  const storage: MemoryStorage = { values: new Map() };
  return {
    now: () => 0,
    isDesktop: () => true,
    isStandalone: () => false,
    browser: () => 'chromium',
    storage: {
      getItem: (key) => storage.values.get(key) ?? null,
      setItem: (key, value) => storage.values.set(key, value),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    ...overrides,
  };
}

describe('install controller', () => {
  it('does not register browser install events for read-only or standalone entries', () => {
    expect(shouldRegisterInstallController({ enabled: false, permanentlySuppressed: false })).toBe(
      false,
    );
    expect(shouldRegisterInstallController({ enabled: true, permanentlySuppressed: true })).toBe(
      false,
    );
    expect(shouldRegisterInstallController({ enabled: true, permanentlySuppressed: false })).toBe(
      true,
    );
  });

  it('offers installation only after an editable desktop session has both edited and reached 90 seconds', () => {
    let now = 0;
    const controller = createInstallController(
      createEnvironment({ now: () => now, browser: () => 'safari' }),
    );

    expect(controller.state().eligible).toBe(false);

    controller.recordUndoableEdit();
    expect(controller.state().eligible).toBe(false);

    now = 90_000;
    expect(controller.state().eligible).toBe(true);
  });

  it('snoozes the first dismissal for a week and later dismissals for two weeks', () => {
    let now = 90_000;
    const environment = createEnvironment({ now: () => now, browser: () => 'firefox' });
    const controller = createInstallController(environment);
    controller.recordUndoableEdit();

    controller.dismiss();
    expect(controller.state().eligible).toBe(false);

    now += 7 * 24 * 60 * 60 * 1000;
    expect(controller.state().eligible).toBe(true);

    controller.dismiss();
    now += 13 * 24 * 60 * 60 * 1000;
    expect(controller.state().eligible).toBe(false);

    now += 24 * 60 * 60 * 1000;
    expect(controller.state().eligible).toBe(true);
  });

  it('suppresses the offer in a standalone app and gives unsupported browsers accurate guidance', () => {
    const controller = createInstallController(
      createEnvironment({ isStandalone: () => true, browser: () => 'safari' }),
    );

    controller.recordUndoableEdit();

    expect(controller.state()).toMatchObject({ eligible: false, permanentlySuppressed: true });
    expect(controller.state().instructions).toContain('Add to Dock');
  });

  it('keeps the Chromium prompt until an explicit install click and clears it after installation', async () => {
    let promptCalls = 0;
    const controller = createInstallController(createEnvironment());
    controller.recordUndoableEdit();
    controller.capturePrompt({
      prompt: async () => {
        promptCalls++;
      },
    });

    expect(promptCalls).toBe(0);
    await controller.requestInstall();
    expect(promptCalls).toBe(1);

    controller.recordInstalled();
    expect(controller.state()).toMatchObject({ canPrompt: false, permanentlySuppressed: true });
  });
});
