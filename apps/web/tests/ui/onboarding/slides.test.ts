import { describe, expect, it } from 'vitest';
import { ONBOARDING_SLIDES } from '../../../src/ui/onboarding/slides';

describe('onboarding slides', () => {
  it('discloses open beta once without turning every slide into a warning', () => {
    expect(ONBOARDING_SLIDES[0].note).toBe(
      'Open beta: features and workflows may change frequently before a stable release.',
    );
    expect(ONBOARDING_SLIDES.slice(1).every((slide) => slide.note === undefined)).toBe(true);
  });
});
