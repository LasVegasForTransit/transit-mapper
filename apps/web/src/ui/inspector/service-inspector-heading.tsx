import type { KeyboardEventHandler } from 'react';

export interface ServiceInspectorHeadingProps {
  color?: string;
  name?: string;
  lineName?: string;
  namePlaceholder?: string;
  selectedStopName?: string;
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
  lineName,
  namePlaceholder = 'Service name',
  selectedStopName,
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
          placeholder={namePlaceholder}
          value={name ?? ''}
          disabled={readOnly}
          onChange={(event) => onNameChange?.(event.target.value)}
          onKeyDown={onNameKeyDown}
        />
      </div>
      <div className="insp-kind">
        {lineName ? `${lineName} · ` : ''}
        {modeLabel} · {distanceLabel} · {totalStops} stop
        {totalStops === 1 ? '' : 's'}
        {selectedStopName ? ` · Call at ${selectedStopName}` : ''}
      </div>
    </>
  );
}
