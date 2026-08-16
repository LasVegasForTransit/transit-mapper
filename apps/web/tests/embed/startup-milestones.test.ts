import { afterEach, describe, expect, it } from 'vitest';
import { createEmbedStartupMilestones } from '../../src/embed/startup-milestones';

afterEach(() => performance.clearMarks());

describe('embed startup milestones', () => {
  it('emits only the lifecycle phases that exist on the public vanilla surface', () => {
    const milestones = createEmbedStartupMilestones();

    milestones.bootstrapStarted();
    milestones.shellMounted();
    milestones.mapStyleReady();
    milestones.systemCommitted();
    milestones.interactive();

    expect(performance.getEntriesByType('mark').map(({ name }) => name)).toEqual([
      'tm:bootstrap-start',
      'tm:shell-mounted',
      'tm:map-style-ready',
      'tm:system-committed',
      'tm:interactive',
    ]);
    expect(performance.getEntriesByName('tm:storage-read-start')).toEqual([]);
    expect(performance.getEntriesByName('tm:service-worker-ready')).toEqual([]);
  });
});
