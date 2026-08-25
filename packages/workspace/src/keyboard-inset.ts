import { useEffect, useState } from 'react';

const MIN_KEYBOARD_PX = 120;

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
