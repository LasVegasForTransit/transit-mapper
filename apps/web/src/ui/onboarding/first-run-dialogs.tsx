import { hasSeenOnboarding, markOnboardingSeen } from '../../storage/localStore';
import { NewSystemLocationDialog } from '../newSystem/NewSystemLocationDialog';
import type { DialogName } from '../UiProvider';
import { continueFirstRunOnboarding, type FirstServiceActions } from './first-run';
import { OnboardingDialog } from './OnboardingDialog';

interface FirstRunDialogsProps {
  activeDialog: 'newSystemLocation' | 'onboarding';
  actions: FirstServiceActions;
  closeDialog: () => void;
  newSystemLocationMode: 'create' | 'importIntoActive';
  openDialog: (name: DialogName) => void;
}

/** The first-run pair travels in one lazy chunk because a new user's location
 * choice flows directly into onboarding. Other dialog chunks stay untouched. */
export function FirstRunDialogs({
  activeDialog,
  actions,
  closeDialog,
  newSystemLocationMode,
  openDialog,
}: FirstRunDialogsProps) {
  if (activeDialog === 'onboarding') {
    return (
      <OnboardingDialog
        onClose={closeDialog}
        onComplete={() => {
          markOnboardingSeen();
          closeDialog();
        }}
      />
    );
  }

  return (
    <NewSystemLocationDialog
      onClose={() => {
        closeDialog();
        // Only bootstrap prepares a drawing tool. Explicit new-system and
        // Replay intro paths must leave editor state untouched.
        continueFirstRunOnboarding({
          mode: newSystemLocationMode,
          hasSeenOnboarding: hasSeenOnboarding(),
          actions,
          openOnboarding: () => openDialog('onboarding'),
        });
      }}
      mode={newSystemLocationMode}
    />
  );
}
