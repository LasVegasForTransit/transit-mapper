import { Icon } from './Icon';
import { useInstall } from '../pwa/InstallProvider';

/** The invitation lives in Workbench's top-chrome flow, never on a fixed App offset. */
export function InstallBanner() {
  const { installState, dismiss, requestInstall } = useInstall();
  if (!installState.eligible) return null;

  return (
    <div className="install-banner" role="status">
      <span className="install-banner-icon">
        <Icon name="download" size={18} />
      </span>
      {/* Both branches are one prose block, not a headline beside a separate
          note. A browser that won't let us call prompt() gives us its own
          instructions to relay, and those read as the rest of the sentence —
          putting them in the action cluster instead made a two-line banner
          whose second line was text pretending to be a button. */}
      <p className="install-banner-message">
        <strong>Install TransitMapper.</strong>{' '}
        {installState.canPrompt
          ? 'Keep your editor one click away and work offline.'
          : installState.instructions}
      </p>
      {installState.canPrompt && (
        <button type="button" className="btn btn-primary" onClick={() => void requestInstall()}>
          Install
        </button>
      )}
      <button type="button" className="app-banner-dismiss" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
