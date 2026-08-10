import type { Tool } from '../../editor/store';

export interface FirstServiceActions {
  setDraftMode: (modeId: string) => void;
  setTool: (tool: Tool) => void;
}

interface ContinueFirstRunOnboardingOptions {
  mode: 'create' | 'importIntoActive';
  hasSeenOnboarding: boolean;
  actions: FirstServiceActions;
  openOnboarding: () => void;
}

/** Network drawing is the low-friction gesture, so a first run begins with the
 * commonest service over the streets the location step just imported. */
export function armFirstService(actions: FirstServiceActions): void {
  actions.setDraftMode('bus');
  actions.setTool('way');
}

/** The bootstrap location dialog is the only path allowed to prepare an
 * editor tool. Explicit new-system and Replay intro flows return untouched. */
export function continueFirstRunOnboarding({
  mode,
  hasSeenOnboarding,
  actions,
  openOnboarding,
}: ContinueFirstRunOnboardingOptions): boolean {
  if (mode !== 'importIntoActive' || hasSeenOnboarding) return false;
  armFirstService(actions);
  openOnboarding();
  return true;
}
