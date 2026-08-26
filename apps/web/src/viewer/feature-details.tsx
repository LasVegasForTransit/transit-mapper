import type { MapFeatureDetails } from '@transitmapper/map/state';
import { Icon } from '../ui/Icon';

export interface FeatureDetailsProps {
  readonly details: MapFeatureDetails;
  readonly onClose: () => void;
}

export function FeatureDetails({ details, onClose }: FeatureDetailsProps) {
  return (
    <section className="viewer-feature-details" aria-labelledby="viewer-feature-title">
      <header className="viewer-feature-header">
        <h2 id="viewer-feature-title">{details.title}</h2>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </header>
      {details.fields.length > 0 ? (
        <dl className="viewer-feature-fields">
          {details.fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
