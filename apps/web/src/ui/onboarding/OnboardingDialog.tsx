import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Modal } from '../Modal';
import { OnboardingPreviewMap } from './OnboardingPreviewMap';
import { ONBOARDING_SLIDES } from './slides';

interface OnboardingDialogProps {
  onClose: () => void;
  onComplete: () => void;
}

/** The first-run introduction. Closing is always allowed, but only the final
 * action counts as completion so an accidental dismissal does not suppress
 * the introduction on the next visit. */
export function OnboardingDialog({ onClose, onComplete }: OnboardingDialogProps) {
  const [index, setIndex] = useState(0);
  const slide = ONBOARDING_SLIDES[index];
  const activeTabId = `onboarding-step-${index}`;
  const panelId = 'onboarding-panel';

  return (
    <Modal
      title={slide.title}
      description="Learn how a service idea becomes a physical and operating transit plan."
      onClose={onClose}
      className="onboarding-modal"
      footer={<OnboardingFooter index={index} onIndexChange={setIndex} onComplete={onComplete} />}
    >
      <div
        className="onboarding-body"
        id={panelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        aria-live="polite"
      >
        <div className="onboarding-explanation">
          <p className="onboarding-copy">{slide.body}</p>
        </div>
        <OnboardingPreviewMap
          key={slide.scene}
          scene={slide.scene}
          description={slide.visualDescription}
        />
      </div>
    </Modal>
  );
}

interface OnboardingFooterProps {
  index: number;
  onIndexChange: (index: number) => void;
  onComplete: () => void;
}

function indexFromKey(key: string, currentIndex: number): number | undefined {
  if (key === 'ArrowRight') return (currentIndex + 1) % ONBOARDING_SLIDES.length;
  if (key === 'ArrowLeft') {
    return (currentIndex - 1 + ONBOARDING_SLIDES.length) % ONBOARDING_SLIDES.length;
  }
  if (key === 'Home') return 0;
  if (key === 'End') return ONBOARDING_SLIDES.length - 1;
  return undefined;
}

function OnboardingFooter({ index, onIndexChange, onComplete }: OnboardingFooterProps) {
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex = indexFromKey(event.key, currentIndex);
    if (nextIndex === undefined) return;
    event.preventDefault();
    onIndexChange(nextIndex);
    dotRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="onboarding-foot">
      <div className="onboarding-back-slot">
        {index > 0 ? (
          <button type="button" className="ghost-btn" onClick={() => onIndexChange(index - 1)}>
            Back
          </button>
        ) : null}
      </div>
      <div className="onboarding-progress">
        <span className="onboarding-step-count">
          {index + 1} of {ONBOARDING_SLIDES.length}
        </span>
        <div className="onboarding-dots" role="tablist" aria-label="Onboarding steps">
          {ONBOARDING_SLIDES.map((slide, slideIndex) => (
            <button
              key={slide.title}
              ref={(element) => {
                dotRefs.current[slideIndex] = element;
              }}
              type="button"
              role="tab"
              id={`onboarding-step-${slideIndex}`}
              aria-controls="onboarding-panel"
              aria-selected={slideIndex === index}
              aria-label={`Go to slide ${slideIndex + 1}: ${slide.title}`}
              tabIndex={slideIndex === index ? 0 : -1}
              className={`onboarding-dot ${slideIndex === index ? 'active' : ''}`}
              onClick={() => onIndexChange(slideIndex)}
              onKeyDown={(event) => selectFromKeyboard(event, slideIndex)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="primary-btn onboarding-next"
        onClick={() =>
          index === ONBOARDING_SLIDES.length - 1 ? onComplete() : onIndexChange(index + 1)
        }
      >
        {index === ONBOARDING_SLIDES.length - 1
          ? 'Draw your first service'
          : index === 0
            ? 'See how it works'
            : 'Next'}
      </button>
    </div>
  );
}
