import { Icon } from './Icon';
import { useInstall } from '../pwa/InstallProvider';

/** The invitation uses MapWorkspace's notice slot, outside hideable editor chrome. */
export function InstallBanner() {
  const { installState, dismiss, requestInstall } = useInstall();
  if (!installState.eligible) return null;

  return (
    <div className="install-banner" role="status">
      <span className="install-banner-icon">
        <Icon name="download" size={18} />
      </span>
      <div className="install-banner-body">
        {/* Both branches are one prose block, not a headline beside a separate
            note. A browser that won't let us call prompt() gives us its own
            instructions to relay, and those read as the rest of the sentence —
            putting them beside the button instead made text that looked like
            a second, broken button. */}
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
      </div>
      <button type="button" className="app-banner-dismiss" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
