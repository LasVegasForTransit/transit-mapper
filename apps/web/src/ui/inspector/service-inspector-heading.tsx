import type { KeyboardEventHandler } from 'react';

export interface ServiceInspectorHeadingProps {
  color: string;
  name: string;
  modeLabel: string;
  distanceLabel: string;
  totalStops: number;
  readOnly: boolean;
  onNameChange?: (name: string) => void;
  onNameKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/** The identifying header shared by every rendering of the Service inspector.
 * Onboarding uses it inside the real Panel shell so its example cannot acquire
 * different spacing, wording, or input behavior from the editor. */
export function ServiceInspectorHeading({
  color,
  name,
  modeLabel,
  distanceLabel,
  totalStops,
  readOnly,
  onNameChange,
  onNameKeyDown,
}: ServiceInspectorHeadingProps) {
  return (
    <>
      <div className="insp-head">
        <span className="dot" style={{ background: color }} />
        <input
          className="insp-name"
          aria-label="Service name"
          value={name}
          disabled={readOnly}
          readOnly={readOnly}
          onChange={(event) => onNameChange?.(event.target.value)}
          onKeyDown={onNameKeyDown}
        />
      </div>
      <div className="insp-kind">
        {modeLabel} · {distanceLabel} · {totalStops} stop
        {totalStops === 1 ? '' : 's'}
      </div>
    </>
  );
}
