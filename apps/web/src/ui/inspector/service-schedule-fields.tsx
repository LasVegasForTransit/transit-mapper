import { useState } from 'react';
import type { ScheduleDayScope, SchedulePeriod } from '@transitmapper/core/model/system';
import { blurOnEnter } from '../formUtils';
import { Icon } from '../Icon';

const FREQUENCY_PRESETS = [5, 10, 15, 20, 30, 60];

interface SpanPreset {
  label: string;
  start: string;
  end: string;
}

const SPAN_PRESETS: SpanPreset[] = [
  { label: 'Daytime', start: '06:00', end: '23:00' },
  { label: 'Early–late', start: '05:00', end: '01:00' },
  { label: '24/7', start: '00:00', end: '23:59' },
];

const DAY_SCOPE_LABEL: Record<ScheduleDayScope, string> = {
  daily: 'Every day',
  weekday: 'Weekdays',
  weekend: 'Weekends',
};

export interface ServiceScheduleFieldsProps {
  idPrefix?: string;
  frequencyMinutes?: number;
  spanStart?: string;
  spanEnd?: string;
  schedule?: SchedulePeriod[];
  readOnly: boolean;
  onFrequencyChange: (frequencyMinutes: number | undefined) => void;
  onSpanChange: (spanStart: string | undefined, spanEnd: string | undefined) => void;
  onOpenFullSchedule: () => void;
}

interface FullScheduleFieldsProps {
  schedule: SchedulePeriod[];
  readOnly: boolean;
  onOpen: () => void;
}

function FullScheduleFields({ schedule, readOnly, onOpen }: FullScheduleFieldsProps) {
  return (
    <>
      <label className="field-label">Schedule</label>
      <ul className="pattern-list">
        {schedule.map((period) => (
          <li key={period.id} className="pattern-row">
            <button type="button" className="pattern-open" onClick={onOpen}>
              <span className="dot ring" />
              <span className="pattern-name">{period.label}</span>
              <span className="pattern-meta">
                {DAY_SCOPE_LABEL[period.days]} · every {period.frequencyMinutes} min ·{' '}
                {period.spanStart}–{period.spanEnd}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="ghost-btn"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        onClick={onOpen}
      >
        <Icon name="clock" size={17} /> {readOnly ? 'View full schedule' : 'Edit full schedule'}
      </button>
    </>
  );
}

interface FrequencyFieldsProps {
  labelId: string;
  frequencyMinutes?: number;
  readOnly: boolean;
  onChange: (frequencyMinutes: number | undefined) => void;
}

function FrequencyFields({ labelId, frequencyMinutes, readOnly, onChange }: FrequencyFieldsProps) {
  const [customOpen, setCustomOpen] = useState(
    () => frequencyMinutes !== undefined && !FREQUENCY_PRESETS.includes(frequencyMinutes),
  );
  return (
    <>
      <label className="field-label" id={labelId}>
        Frequency · peak headway
      </label>
      <div className="chip-row" role="group" aria-labelledby={labelId}>
        {FREQUENCY_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`chip ${!customOpen && frequencyMinutes === minutes ? 'active' : ''}`}
            aria-pressed={!customOpen && frequencyMinutes === minutes}
            disabled={readOnly}
            onClick={() => {
              setCustomOpen(false);
              onChange(minutes);
            }}
          >
            {minutes} min
          </button>
        ))}
        <button
          type="button"
          className={`chip ${customOpen ? 'active' : ''}`}
          aria-pressed={customOpen}
          disabled={readOnly}
          onClick={() => setCustomOpen(true)}
        >
          Custom
        </button>
      </div>
      {customOpen && (
        <div className="freq-row">
          <input
            type="number"
            min={1}
            className="freq-input"
            aria-label="Custom peak headway in minutes"
            value={frequencyMinutes ?? ''}
            disabled={readOnly}
            placeholder="Not set"
            onChange={(event) =>
              onChange(
                event.target.value === ''
                  ? undefined
                  : Math.max(1, Math.round(Number(event.target.value))),
              )
            }
            onKeyDown={blurOnEnter}
          />
          <span className="freq-suffix">min between vehicles, peak</span>
        </div>
      )}
    </>
  );
}

interface SpanFieldsProps {
  labelId: string;
  spanStart?: string;
  spanEnd?: string;
  readOnly: boolean;
  onChange: (spanStart: string | undefined, spanEnd: string | undefined) => void;
}

function SpanFields({ labelId, spanStart, spanEnd, readOnly, onChange }: SpanFieldsProps) {
  const [customOpen, setCustomOpen] = useState(
    () =>
      (spanStart !== undefined || spanEnd !== undefined) &&
      !SPAN_PRESETS.some((preset) => preset.start === spanStart && preset.end === spanEnd),
  );
  return (
    <>
      <label className="field-label" id={labelId}>
        Service hours · span of service
      </label>
      <div className="chip-row" role="group" aria-labelledby={labelId}>
        {SPAN_PRESETS.map((preset) => {
          const active = !customOpen && spanStart === preset.start && spanEnd === preset.end;
          return (
            <button
              key={preset.label}
              type="button"
              className={`chip ${active ? 'active' : ''}`}
              aria-pressed={active}
              disabled={readOnly}
              onClick={() => {
                setCustomOpen(false);
                onChange(preset.start, preset.end);
              }}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          className={`chip ${customOpen ? 'active' : ''}`}
          aria-pressed={customOpen}
          disabled={readOnly}
          onClick={() => setCustomOpen(true)}
        >
          Custom
        </button>
      </div>
      {customOpen && (
        <div className="freq-row">
          <input
            type="time"
            className="freq-input freq-time"
            aria-label="First departure"
            value={spanStart ?? ''}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.value || undefined, spanEnd)}
          />
          <span className="freq-suffix">to</span>
          <input
            type="time"
            className="freq-input freq-time"
            aria-label="Last departure"
            value={spanEnd ?? ''}
            disabled={readOnly}
            onChange={(event) => onChange(spanStart, event.target.value || undefined)}
          />
        </div>
      )}
    </>
  );
}

/** The Service inspector's schedule controls. Onboarding renders this same
 * component read-only so its product-looking UI cannot drift from the editor. */
export function ServiceScheduleFields({
  idPrefix = 'service-schedule',
  frequencyMinutes,
  spanStart,
  spanEnd,
  schedule,
  readOnly,
  onFrequencyChange,
  onSpanChange,
  onOpenFullSchedule,
}: ServiceScheduleFieldsProps) {
  if (schedule && schedule.length > 0) {
    return (
      <FullScheduleFields schedule={schedule} readOnly={readOnly} onOpen={onOpenFullSchedule} />
    );
  }
  return (
    <>
      <FrequencyFields
        labelId={`${idPrefix}-frequency-label`}
        frequencyMinutes={frequencyMinutes}
        readOnly={readOnly}
        onChange={onFrequencyChange}
      />
      <SpanFields
        labelId={`${idPrefix}-span-label`}
        spanStart={spanStart}
        spanEnd={spanEnd}
        readOnly={readOnly}
        onChange={onSpanChange}
      />
      {!readOnly && (
        <button
          type="button"
          className="link-btn"
          style={{ display: 'block', marginBottom: 12 }}
          onClick={onOpenFullSchedule}
        >
          Use a full schedule instead
        </button>
      )}
    </>
  );
}
