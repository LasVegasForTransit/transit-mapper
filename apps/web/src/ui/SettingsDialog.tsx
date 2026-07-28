import { useUnitPreference, setUnitPreference } from '../services/userPreferences';
import { messages } from '../i18n/messages';
import { Modal } from './Modal';

export interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const currentUnitSystem = useUnitPreference();

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
    </Modal>
  );
}
