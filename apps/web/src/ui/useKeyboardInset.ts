import { useEffect, useState } from 'react';

/**
 * How many pixels of the viewport's bottom edge the on-screen keyboard covers.
 *
 * A phone keyboard does not resize the layout viewport, so a bottom-anchored
 * surface stays exactly where it was and the keyboard opens on top of it: focus
 * the system-name field or an inspector input and the thing being typed into is
 * behind the keys. `visualViewport` is the only API that reports this, since it
 * describes what is actually on screen rather than what the page was laid out
 * against.
 *
 * Returns 0 where there is no keyboard, no `visualViewport`, or the keyboard is
 * closed, so a caller can add it unconditionally.
 */
/**
 * The shortest viewport difference treated as a keyboard.
 *
 * A retracting URL bar changes the visual viewport by roughly 40-60px and
 * looks exactly like a very short keyboard. Below this, the difference is
 * assumed to be browser chrome: reacting to it would lift the sheet off the
 * bottom edge every time the page scrolled.
 */
const MIN_KEYBOARD_PX = 120;

/**
 * The pure measurement, extracted so it can be verified without a browser.
 *
 * The keyboard's height is what the layout viewport has that the visual one
 * does not, less however far the page is scrolled within it.
 */
export function keyboardInsetFrom(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  const covered = layoutHeight - visualHeight - visualOffsetTop;
  return covered > MIN_KEYBOARD_PX ? covered : 0;
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport) return;

    const measure = () => {
      setInset(keyboardInsetFrom(window.innerHeight, viewport.height, viewport.offsetTop));
    };

    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  return inset;
}
