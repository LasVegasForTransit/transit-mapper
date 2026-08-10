import { describe, expect, it } from 'vitest';
import { continueFirstRunOnboarding } from '../../../src/ui/onboarding/first-run';

describe('first-run onboarding handoff', () => {
  it('arms the Bus line tool before opening onboarding for a genuine first run', () => {
    const calls: string[] = [];

    const opened = continueFirstRunOnboarding({
      mode: 'importIntoActive',
      hasSeenOnboarding: false,
      actions: {
        setDraftMode: (modeId) => calls.push(`mode:${modeId}`),
        setTool: (tool) => calls.push(`tool:${tool}`),
      },
      openOnboarding: () => calls.push('open'),
    });

    expect(opened).toBe(true);
    expect(calls).toEqual(['mode:bus', 'tool:way', 'open']);
  });

  it('does not change editor state when onboarding has already been seen', () => {
    const calls: string[] = [];

    const opened = continueFirstRunOnboarding({
      mode: 'importIntoActive',
      hasSeenOnboarding: true,
      actions: {
        setDraftMode: (modeId) => calls.push(`mode:${modeId}`),
        setTool: (tool) => calls.push(`tool:${tool}`),
      },
      openOnboarding: () => calls.push('open'),
    });

    expect(opened).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves explicit new-system and replay flows outside the first-run handoff', () => {
    const calls: string[] = [];

    const opened = continueFirstRunOnboarding({
      mode: 'create',
      hasSeenOnboarding: false,
      actions: {
        setDraftMode: (modeId) => calls.push(`mode:${modeId}`),
        setTool: (tool) => calls.push(`tool:${tool}`),
      },
      openOnboarding: () => calls.push('open'),
    });

    expect(opened).toBe(false);
    expect(calls).toEqual([]);
  });
});
