import { describe, expect, it } from 'vitest';
import { installSettingsPresentation } from './settings';
import type { InstallState } from './install';

function installState(overrides: Partial<InstallState> = {}): InstallState {
  return {
    browser: 'chromium',
    isDesktop: true,
    eligible: true,
    canPrompt: false,
    permanentlySuppressed: false,
    instructions: 'Use your browser’s Install option from the address bar or menu.',
    ...overrides,
  };
}

describe('install settings presentation', () => {
  it('uses the native action only when a deferred prompt is available', () => {
    expect(installSettingsPresentation(installState({ canPrompt: true }))).toEqual({
      kind: 'native',
      message: 'Keep your editor one click away and work offline.',
    });
  });

  it('explains desktop, installed, and browser-guidance states truthfully', () => {
    expect(installSettingsPresentation(installState({ isDesktop: false }))).toEqual({
      kind: 'desktop-required',
      message: 'Installation guidance is available from a desktop browser.',
    });
    expect(installSettingsPresentation(installState({ permanentlySuppressed: true }))).toEqual({
      kind: 'installed',
      message: 'TransitMapper is installed on this browser profile.',
    });
    expect(
      installSettingsPresentation(
        installState({
          browser: 'safari',
          instructions: 'In Safari, choose File or Share, then Add to Dock.',
        }),
      ),
    ).toEqual({ kind: 'guidance', message: 'In Safari, choose File or Share, then Add to Dock.' });
    expect(
      installSettingsPresentation(
        installState({
          browser: 'firefox',
          instructions:
            'Firefox does not support installing TransitMapper as a desktop app. Use Chrome, Edge, or Safari instead.',
        }),
      ),
    ).toEqual({
      kind: 'guidance',
      message:
        'Firefox does not support installing TransitMapper as a desktop app. Use Chrome, Edge, or Safari instead.',
    });
  });
});
