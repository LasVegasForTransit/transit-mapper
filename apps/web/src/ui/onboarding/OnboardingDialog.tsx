import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Modal } from '../Modal';
import { OnboardingPreviewMap } from './OnboardingPreviewMap';
import { ONBOARDING_FIXTURE_SYSTEM, onboardingViewOptions } from './fixtureSystem';
import { ONBOARDING_SLIDES, type OnboardingSlideVisual } from './slides';

interface OnboardingDialogProps {
  onClose: () => void;
  onComplete: () => void;
}

/** The first-run introduction. Closing is always allowed, but only the final
 *  action counts as completion so an accidental dismissal does not suppress
 *  the welcome on the next visit. */
export function OnboardingDialog({ onClose, onComplete }: OnboardingDialogProps) {
  const [index, setIndex] = useState(0);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const slide = ONBOARDING_SLIDES[index];
  const isLast = index === ONBOARDING_SLIDES.length - 1;

  const selectFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % ONBOARDING_SLIDES.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + ONBOARDING_SLIDES.length) % ONBOARDING_SLIDES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = ONBOARDING_SLIDES.length - 1;
    }
    if (nextIndex === undefined) return;

    event.preventDefault();
    setIndex(nextIndex);
    dotRefs.current[nextIndex]?.focus();
  };

  return (
    <Modal
      title={slide.title}
      description="Learn how to sketch and develop a transit system."
      onClose={onClose}
      className="onboarding-modal"
      footer={
        <div className="onboarding-foot">
          <div className="onboarding-back-slot">
            {index > 0 && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setIndex((current) => current - 1)}
              >
                Back
              </button>
            )}
          </div>
          <div className="onboarding-dots" role="tablist" aria-label="Onboarding steps">
            {ONBOARDING_SLIDES.map((s, i) => (
              <button
                key={s.title}
                ref={(element) => {
                  dotRefs.current[i] = element;
                }}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to slide ${i + 1}: ${s.title}`}
                tabIndex={i === index ? 0 : -1}
                className={`onboarding-dot ${i === index ? 'active' : ''}`}
                onClick={() => setIndex(i)}
                onKeyDown={(event) => selectFromKeyboard(event, i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="primary-btn onboarding-next"
            onClick={() => (isLast ? onComplete() : setIndex((current) => current + 1))}
          >
            {isLast ? 'Start drawing' : 'Next'}
          </button>
        </div>
      }
    >
      <div className="onboarding-body">
        <p className="onboarding-copy">{slide.body}</p>
        {slide.note ? <OnboardingNote text={slide.note} /> : null}
        <OnboardingSlideVisualView visual={slide.visual} />
      </div>
    </Modal>
  );
}

function OnboardingNote({ text }: { text: string }) {
  const label = 'Open beta';
  const body = text.startsWith(`${label}: `) ? text.slice(label.length + 2) : text;

  return (
    <p className="onboarding-note">
      <span className="onboarding-note-label">{label}</span>
      <span className="sr-only">: </span>
      <span>{body}</span>
    </p>
  );
}

interface OnboardingSlideVisualViewProps {
  visual: OnboardingSlideVisual;
}

function OnboardingSlideVisualView({ visual }: OnboardingSlideVisualViewProps) {
  if (visual.kind === 'triPreview') {
    const previews = [
      { viewMode: 'infrastructure', label: 'Infrastructure' },
      { viewMode: 'network', label: 'Network' },
      { viewMode: 'diagram', label: 'Diagram' },
    ] as const;
    return (
      <div className="onboarding-tri-preview">
        {previews.map(({ viewMode, label }) => (
          <figure className="onboarding-tri-preview-item" key={viewMode}>
            <figcaption className="onboarding-preview-label">{label}</figcaption>
            <OnboardingPreviewMap
              system={ONBOARDING_FIXTURE_SYSTEM}
              view={onboardingViewOptions(viewMode)}
              className="onboarding-tri-preview-map"
            />
          </figure>
        ))}
      </div>
    );
  }
  return (
    <div className="onboarding-single-preview">
      {visual.key === 'service' && (
        <div className="onboarding-preview-key" aria-label="Example service">
          <span>
            <i className="onboarding-service-swatch" />
            Crosstown
          </span>
          <span className="onboarding-preview-frequency">Every 10 minutes</span>
        </div>
      )}
      {visual.key === 'infrastructure' && (
        <div className="onboarding-preview-key" aria-label="Example infrastructure">
          <span>Streets</span>
          <span>Light rail tracks</span>
        </div>
      )}
      <OnboardingPreviewMap
        system={ONBOARDING_FIXTURE_SYSTEM}
        view={onboardingViewOptions(visual.viewMode)}
        animateVehicle={visual.animateVehicle}
        className="onboarding-single-preview-map"
      />
    </div>
  );
}
