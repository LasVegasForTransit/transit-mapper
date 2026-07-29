import type { InstallState } from './install';

export type InstallSettingsPresentationKind =
  'installed' | 'desktop-required' | 'native' | 'guidance';

export interface InstallSettingsPresentation {
  kind: InstallSettingsPresentationKind;
  message: string;
}

/** Keeps the Settings copy and action truthful across native and manual flows. */
export function installSettingsPresentation(state: InstallState): InstallSettingsPresentation {
  if (state.permanentlySuppressed) {
    return { kind: 'installed', message: 'TransitMapper is installed on this browser profile.' };
  }
  if (!state.isDesktop) {
    return {
      kind: 'desktop-required',
      message: 'Installation guidance is available from a desktop browser.',
    };
  }
  if (state.canPrompt) {
    return { kind: 'native', message: 'Keep your editor one click away and work offline.' };
  }
  return { kind: 'guidance', message: state.instructions };
}
