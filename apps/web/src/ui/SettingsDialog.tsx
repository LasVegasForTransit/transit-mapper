import { useState } from 'react';
import { useUnitPreference, setUnitPreference } from '../services/userPreferences';
import { messages } from '../i18n/messages';
import { useInstall } from '../pwa/InstallProvider';
import { protectOfflineData, type OfflineDataProtection } from '../pwa/persistence';
import { installSettingsPresentation } from '../pwa/settings';
import { Modal } from './Modal';

export interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const currentUnitSystem = useUnitPreference();
  const { installState, requestInstall } = useInstall();
  const [protection, setProtection] = useState<OfflineDataProtection | null>(null);
  const installPresentation = installSettingsPresentation(installState);

  return (
    <Modal
      title={messages.settings.title}
      description={messages.settings.description}
      onClose={onClose}
    >
      <div className="settings-section">
        <label className="field-label">{messages.settings.units.label}</label>
        <div className="chip-row" role="group" aria-label={messages.settings.units.label}>
          {(['metric', 'imperial'] as const).map((system) => (
            <button
              key={system}
              className={`chip ${currentUnitSystem === system ? 'active' : ''}`}
              aria-pressed={currentUnitSystem === system}
              onClick={() => setUnitPreference(system)}
            >
              {system === 'metric'
                ? messages.settings.units.metric
                : messages.settings.units.imperial}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <label className="field-label">Install TransitMapper</label>
        {installPresentation.kind === 'native' ? (
          <>
            <p className="settings-copy">{installPresentation.message}</p>
            <button type="button" className="btn btn-primary" onClick={() => void requestInstall()}>
              Install
            </button>
          </>
        ) : (
          <p className="settings-copy">{installPresentation.message}</p>
        )}
      </div>
      <div className="settings-section">
        <label className="field-label">Protect offline data</label>
        <p className="settings-copy">
          Ask this browser to keep TransitMapper’s locally stored systems from being evicted when
          storage is tight.
        </p>
        <button
          type="button"
          className="btn btn-bordered"
          onClick={() => void protectOfflineData().then(setProtection)}
        >
          Protect offline data
        </button>
        {protection === 'protected' && (
          <p className="settings-copy" role="status">
            This browser will protect TransitMapper’s offline data.
          </p>
        )}
        {protection === 'not-granted' && (
          <p className="settings-copy" role="status">
            This browser did not grant persistent storage.
          </p>
        )}
        {protection === 'unavailable' && (
          <p className="settings-copy" role="status">
            This browser does not offer persistent storage controls.
          </p>
        )}
      </div>
    </Modal>
  );
}
