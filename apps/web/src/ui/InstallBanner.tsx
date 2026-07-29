import { Icon } from './Icon';
import { useInstall } from '../pwa/InstallProvider';

/** The invitation lives in Workbench's top-chrome flow, never on a fixed App offset. */
export function InstallBanner() {
  const { installState, dismiss, requestInstall } = useInstall();
  if (!installState.eligible) return null;

  return (
    <div className="install-banner" role="status">
      <div>
        <strong>Install TransitMapper</strong>
        <span> Keep your editor one click away and work offline.</span>
      </div>
      <div className="install-banner-actions">
        {installState.canPrompt ? (
          <button type="button" className="btn btn-primary" onClick={() => void requestInstall()}>
            Install
          </button>
        ) : (
          <span className="install-banner-guidance">{installState.instructions}</span>
        )}
        <button type="button" className="app-banner-dismiss" onClick={dismiss} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
