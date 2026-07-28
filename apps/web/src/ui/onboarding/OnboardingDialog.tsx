import { useState } from 'react';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { OnboardingPreviewMap } from './OnboardingPreviewMap';
import { ONBOARDING_FIXTURE_SYSTEM, onboardingViewOptions } from './fixtureSystem';
import { ONBOARDING_SLIDES, type OnboardingSlideVisual } from './slides';

interface OnboardingDialogProps {
  onClose: () => void;
}

/** The first-run introduction — freely skippable from any slide (Skip, close,
 *  or jump straight to a dot), never a gate the app makes you clear. */
export function OnboardingDialog({ onClose }: OnboardingDialogProps) {
  const [index, setIndex] = useState(0);
  const slide = ONBOARDING_SLIDES[index];
  const isLast = index === ONBOARDING_SLIDES.length - 1;

  return (
    <Modal
      title={slide.title}
      description="A short introduction to TransitMapper's core ideas."
      onClose={onClose}
      className="onboarding-modal"
      footer={
        <div className="onboarding-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Skip
          </button>
          <div className="onboarding-dots" role="tablist" aria-label="Slides">
            {ONBOARDING_SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to slide ${i + 1}: ${s.title}`}
                className={`onboarding-dot ${i === index ? 'active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={() => (isLast ? onClose() : setIndex(index + 1))}
          >
            {isLast ? 'Get started' : 'Next'}
          </button>
        </div>
      }
    >
      <div className="onboarding-body">
        <OnboardingSlideVisualView visual={slide.visual} />
        <p className="onboarding-copy">{slide.body}</p>
      </div>
    </Modal>
  );
}

interface OnboardingSlideVisualViewProps {
  visual: OnboardingSlideVisual;
}

function OnboardingSlideVisualView({ visual }: OnboardingSlideVisualViewProps) {
  if (visual.kind === 'triPreview') {
    return (
      <div className="onboarding-tri-preview">
        {(['infrastructure', 'network', 'diagram'] as const).map((viewMode) => (
          <OnboardingPreviewMap
            key={viewMode}
            system={ONBOARDING_FIXTURE_SYSTEM}
            view={onboardingViewOptions(viewMode)}
            className="onboarding-tri-preview-item"
          />
        ))}
      </div>
    );
  }
  if (visual.kind === 'singlePreview') {
    return (
      <OnboardingPreviewMap
        system={ONBOARDING_FIXTURE_SYSTEM}
        view={onboardingViewOptions(visual.viewMode)}
        animateVehicle={visual.animateVehicle}
        className="onboarding-single-preview"
      />
    );
  }
  return (
    <div className="onboarding-icons">
      {visual.icons.map((icon) => (
        <Icon key={icon} name={icon} size={40} />
      ))}
    </div>
  );
}
