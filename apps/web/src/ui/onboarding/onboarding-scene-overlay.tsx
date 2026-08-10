import { ONBOARDING_FIXTURE_SYSTEM, ONBOARDING_FLEET } from './fixtureSystem';
import type { OnboardingSceneId } from './slides';

interface OnboardingSceneOverlayProps {
  scene: OnboardingSceneId;
  failed: boolean;
  description: string;
  clockLabel: string;
}

const SCENE_LABEL: Record<OnboardingSceneId, string> = {
  draw: 'Network · Bus',
  infrastructure: 'Infrastructure',
  operations: 'Service plan',
  simulate: 'System running',
};

const crosstown = ONBOARDING_FIXTURE_SYSTEM.services.find(
  (service) => service.id === 'port-mason-crosstown',
);
const harborLine = ONBOARDING_FIXTURE_SYSTEM.services.find(
  (service) => service.id === 'port-mason-harbor-line',
);

function ServiceKey() {
  return (
    <div className="onboarding-service-key">
      <span>
        <i
          className="onboarding-service-swatch"
          style={{ backgroundColor: crosstown?.color }}
          aria-hidden="true"
        />
        Crosstown
      </span>
      <span>
        <i
          className="onboarding-service-swatch"
          style={{ backgroundColor: harborLine?.color }}
          aria-hidden="true"
        />
        Harbor Line
      </span>
    </div>
  );
}

interface OperatingCardProps {
  clockLabel: string;
  running: boolean;
  showPatterns: boolean;
}

function OperatingCard({ clockLabel, running, showPatterns }: OperatingCardProps) {
  return (
    <div className="onboarding-operating-card">
      <div className="onboarding-operating-card-head">
        <span>
          <i
            className="onboarding-service-swatch"
            style={{ backgroundColor: crosstown?.color }}
            aria-hidden="true"
          />
          Crosstown
        </span>
        {running ? <time>{clockLabel}</time> : null}
      </div>
      <div className="onboarding-operating-values">
        <span>Every 10 min</span>
        <span>6 AM–11 PM</span>
      </div>
      {showPatterns ? (
        <div className="onboarding-pattern-list">
          <small>Patterns</small>
          {crosstown?.patterns.map((pattern) => (
            <span key={pattern.id}>{pattern.name}</span>
          ))}
        </div>
      ) : null}
      <strong>
        {ONBOARDING_FLEET} {ONBOARDING_FLEET === 1 ? 'vehicle' : 'vehicles'} required
      </strong>
    </div>
  );
}

/** DOM presentation for facts a small map should not try to typeset. It reads
 * only fixed fixture outputs and scene props, so it cannot mutate the editor or
 * drift from the proposal the production renderer is drawing. */
export function OnboardingSceneOverlay({
  scene,
  failed,
  description,
  clockLabel,
}: OnboardingSceneOverlayProps) {
  if (failed) {
    return (
      <div className="onboarding-preview-fallback">
        <ServiceKey />
        <p>{description}</p>
        <div className="onboarding-fallback-values">
          <span>Every 10 min</span>
          <span>6 AM–11 PM</span>
          <span>{ONBOARDING_FLEET} vehicles</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <span className="onboarding-scene-label">{SCENE_LABEL[scene]}</span>
      {scene === 'draw' ? (
        <div className="onboarding-draw-hint">
          <span aria-hidden="true">↳</span> Following existing streets
        </div>
      ) : null}
      {scene === 'infrastructure' ? (
        <div className="onboarding-infrastructure-callout">
          <span>
            <i className="onboarding-imported-swatch" aria-hidden="true" />
            Imported streets + freight track
          </span>
          <span>
            <i className="onboarding-new-link-swatch" aria-hidden="true" />
            New downtown rail link
          </span>
        </div>
      ) : null}
      {scene === 'operations' || scene === 'simulate' ? (
        <OperatingCard
          clockLabel={clockLabel}
          running={scene === 'simulate'}
          showPatterns={scene === 'operations'}
        />
      ) : null}
    </>
  );
}
