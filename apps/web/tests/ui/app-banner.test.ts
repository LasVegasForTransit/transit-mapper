import { describe, expect, it } from 'vitest';
import { resolveAppBanner, type AppBannerInputs, type NoticeCause } from '../../src/ui/app-banner';

/** Nothing wrong: the state a healthy editor sits in. Each case below turns on
 *  exactly the one field it is about, so a passing test cannot be an accident
 *  of some other field left set. */
const calm: AppBannerInputs = {
  save: 'saved',
  bootstrap: { kind: 'ok' },
  updateWaiting: false,
  offlineReady: false,
  offlineReadiness: 'deferred',
  notice: null,
  documentSlowToLoad: false,
  online: true,
};

describe('which message the app shows', () => {
  it('shows nothing when nothing is wrong', () => {
    expect(resolveAppBanner(calm)).toBeNull();
  });

  it('never lets a message be dismissed while its cause is still true', () => {
    const stillTrue: AppBannerInputs[] = [
      { ...calm, save: 'full' },
      { ...calm, save: 'unavailable' },
      { ...calm, bootstrap: { kind: 'storage-unavailable' } },
      { ...calm, bootstrap: { kind: 'share-failed' } },
      { ...calm, updateWaiting: true },
    ];

    for (const inputs of stillTrue) {
      expect(resolveAppBanner(inputs)?.dismiss).toBeNull();
    }
  });

  it('lets a message be dismissed once it only describes the past', () => {
    expect(resolveAppBanner({ ...calm, notice: 'dialog-failed' })?.dismiss).not.toBeNull();
    expect(resolveAppBanner({ ...calm, offlineReady: true })?.dismiss).not.toBeNull();
  });
});

describe('a startup that produced no document', () => {
  // Both of these used to leave the editor as a sentence and one button, so a
  // retry that keeps failing meant a working editor nobody was allowed to type
  // into. Every failure has to offer a way forward that does not depend on the
  // thing that is broken.
  const failures: AppBannerInputs[] = [
    { ...calm, bootstrap: { kind: 'storage-unavailable' } },
    { ...calm, bootstrap: { kind: 'share-failed' } },
  ];

  it('always offers a way forward that is not another retry', () => {
    for (const inputs of failures) {
      expect(resolveAppBanner(inputs)?.actions.map((a) => a.kind)).toContain('start-new-system');
    }
  });

  it('offers the retry first, because retrying is the answer that keeps the data', () => {
    for (const inputs of failures) {
      expect(resolveAppBanner(inputs)?.actions[0]?.kind).toBe('retry-bootstrap');
    }
  });

  // Storage being unreachable is not the same as the data being gone, and a
  // message that blurs the two invites someone to give up on work that is
  // still sitting there.
  it('says nothing was replaced when storage could not be reached', () => {
    const message = resolveAppBanner(failures[0])?.message ?? '';

    expect(message).toContain('Nothing was replaced');
  });
});

describe('which message wins', () => {
  // A failing autosave is the only one still getting worse while it goes
  // unread, so it outranks every message describing something already settled.
  it('puts a failing save above everything else', () => {
    const everything: AppBannerInputs = {
      save: 'full',
      bootstrap: { kind: 'storage-unavailable' },
      updateWaiting: true,
      offlineReady: true,
      offlineReadiness: 'essential',
      notice: 'corrupt-system',
      documentSlowToLoad: true,
      online: false,
    };

    expect(resolveAppBanner(everything)?.message).toContain('storage is full');
  });

  it('puts a failed startup above a waiting update', () => {
    const inputs: AppBannerInputs = {
      ...calm,
      bootstrap: { kind: 'storage-unavailable' },
      updateWaiting: true,
    };

    expect(resolveAppBanner(inputs)?.actions.map((a) => a.kind)).toEqual([
      'retry-bootstrap',
      'start-new-system',
    ]);
  });

  // The editor is on screen and working the whole time it waits, so a message
  // about waiting must never crowd out one about something being wrong.
  it('puts every real problem above the note that loading is slow', () => {
    const slow = { ...calm, documentSlowToLoad: true };

    expect(resolveAppBanner({ ...slow, save: 'full' })?.message).toContain('storage is full');
    expect(resolveAppBanner({ ...slow, notice: 'dialog-failed' })?.message).toContain('dialog');
    expect(resolveAppBanner(slow)?.message).toContain('Still opening');
  });

  it('puts a waiting update above both pieces of good news', () => {
    const inputs: AppBannerInputs = {
      ...calm,
      updateWaiting: true,
      offlineReady: true,
      notice: 'basemap-unavailable',
    };

    expect(resolveAppBanner(inputs)?.actions).toEqual([{ kind: 'reload', label: 'Reload' }]);
  });

  it('puts the offline-ready note above a notice', () => {
    const inputs: AppBannerInputs = {
      ...calm,
      offlineReady: true,
      offlineReadiness: 'essential',
      notice: 'dialog-failed',
    };

    expect(resolveAppBanner(inputs)?.message).toContain('reopen offline');
  });

  it('never describes the background map as available offline', () => {
    for (const offlineReadiness of [
      'essential',
      'adaptive-pending',
      'complete',
      'deferred',
    ] as const) {
      const message = resolveAppBanner({ ...calm, offlineReady: true, offlineReadiness })?.message;
      expect(message).toContain('background map still needs a connection');
    }
  });
});

describe('naming the network as the reason', () => {
  // The two failures a reader can actually do something about, and the two the
  // browser used to describe with the text of a fetch exception.
  const remoteFailures: AppBannerInputs[] = [
    { ...calm, bootstrap: { kind: 'share-failed' } },
    { ...calm, notice: 'basemap-unavailable' },
  ];

  it('says so when the browser has no network', () => {
    for (const inputs of remoteFailures) {
      expect(resolveAppBanner({ ...inputs, online: false })?.message).toContain('offline');
    }
  });

  it('does not claim offline when the browser thinks it has a network', () => {
    for (const inputs of remoteFailures) {
      expect(resolveAppBanner({ ...inputs, online: true })?.message).not.toContain('offline');
    }
  });

  it('does not claim which background remains after an update fails', () => {
    const cause: AppBannerInputs = { ...calm, notice: 'basemap-unavailable' };

    expect(resolveAppBanner({ ...cause, online: true })?.message).toBe(
      'The background map couldn’t be updated. Your transit system is still visible and saved.',
    );
    expect(resolveAppBanner({ ...cause, online: false })?.message).toBe(
      'You’re offline, so the background map can’t update. Your transit system is still visible and saved.',
    );
  });

  // The message is derived from the cause each render rather than frozen when
  // the failure happened, so losing the network afterwards rewords it. That is
  // the entire reason `notice` holds a cause instead of a sentence.
  it('rewords a failure that already happened when the network drops later', () => {
    const cause: AppBannerInputs = { ...calm, notice: 'basemap-unavailable' };

    expect(resolveAppBanner({ ...cause, online: true })?.message).not.toEqual(
      resolveAppBanner({ ...cause, online: false })?.message,
    );
  });

  // Being offline explains why something failed. It never means the user's own
  // work is at risk, and a message that blurs the two causes real alarm.
  it('says the work is safe whenever it blames the network', () => {
    for (const inputs of remoteFailures) {
      const message = resolveAppBanner({ ...inputs, online: false })?.message ?? '';
      expect(message).toMatch(/saved|aren’t stored on this device/);
    }
  });

  // Local failures have nothing to do with connectivity, and blaming the
  // network for them would send someone off checking their wifi.
  it('leaves messages about local storage alone', () => {
    const local: AppBannerInputs[] = [
      { ...calm, save: 'full' },
      { ...calm, bootstrap: { kind: 'storage-unavailable' } },
      { ...calm, notice: 'corrupt-system' },
    ];

    for (const inputs of local) {
      expect(resolveAppBanner({ ...inputs, online: false })?.message).not.toContain('offline');
    }
  });
});

describe('how a message reads', () => {
  const causes: NoticeCause[] = [
    'corrupt-system',
    'corrupt-open',
    'dialog-failed',
    'basemap-unavailable',
    'saved-system-arrived',
  ];

  it('has a sentence for every cause', () => {
    for (const notice of causes) {
      const message = resolveAppBanner({ ...calm, notice })?.message ?? '';
      expect(message.length).toBeGreaterThan(0);
    }
  });

  // Both messages about unreadable data exist to say the bytes are still
  // there. "Your work is gone" and "your work is here but unreadable" call for
  // very different reactions, and only one of them is true.
  it('says the damaged copy still exists whenever a system could not be read', () => {
    for (const notice of ['corrupt-system', 'corrupt-open'] as const) {
      expect(resolveAppBanner({ ...calm, notice })?.message).toContain('still saved');
    }
  });

  // Good news gets the accent tone; the danger red is reserved for the
  // messages that report a problem.
  it('keeps the danger tone off the two messages that are not problems', () => {
    expect(resolveAppBanner({ ...calm, updateWaiting: true })?.tone).toBe('update');
    expect(resolveAppBanner({ ...calm, offlineReady: true })?.tone).toBe('update');
    expect(resolveAppBanner({ ...calm, notice: 'dialog-failed' })?.tone).toBe('danger');
  });

  // A screen reader should interrupt for something still going wrong and wait
  // its turn for everything else.
  it('interrupts only for a condition that is still true', () => {
    expect(resolveAppBanner({ ...calm, save: 'full' })?.live).toBe('alert');
    expect(resolveAppBanner({ ...calm, bootstrap: { kind: 'storage-unavailable' } })?.live).toBe(
      'alert',
    );
    expect(resolveAppBanner({ ...calm, updateWaiting: true })?.live).toBe('status');
    expect(resolveAppBanner({ ...calm, notice: 'dialog-failed' })?.live).toBe('status');
  });

  // The wrapped layout aligns to the top, which only looks right on a message
  // long enough to wrap. Putting a one-liner in it leaves the text visibly
  // high against its button.
  it('keeps one-liners out of the layout meant for wrapping text', () => {
    expect(resolveAppBanner({ ...calm, offlineReady: true })?.layout).toBe('inline');
    expect(resolveAppBanner({ ...calm, notice: 'corrupt-system' })?.layout).toBe('wrapped');
  });
});
