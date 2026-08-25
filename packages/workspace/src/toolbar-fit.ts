import { useLayoutEffect, useState, type RefObject } from 'react';

export type ToolbarFit = 'full' | 'labels' | 'tertiary' | 'overflow';
export const TOOLBAR_FITS: ToolbarFit[] = ['full', 'labels', 'tertiary', 'overflow'];

function naturalWidth(bar: HTMLElement): number {
  const width = bar.style.width;
  const flex = bar.style.flex;
  bar.style.flex = 'none';
  bar.style.width = 'max-content';
  const measured = bar.getBoundingClientRect().width;
  bar.style.flex = flex;
  bar.style.width = width;
  return measured;
}

export function useToolbarFit(
  container: RefObject<HTMLDivElement | null>,
  bar: RefObject<HTMLDivElement | null>,
  compact: boolean,
): ToolbarFit {
  const [fit, setFit] = useState<ToolbarFit>('full');

  useLayoutEffect(() => {
    const box = container.current;
    const element = bar.current;
    if (compact || !box || !element) return;

    const measure = () => {
      const rendered = element.dataset.fit;
      const priceOf = (candidate: ToolbarFit) => {
        element.dataset.fit = candidate;
        return naturalWidth(element);
      };
      const narrowest = TOOLBAR_FITS[TOOLBAR_FITS.length - 1];
      const floor = `${Math.ceil(priceOf(narrowest))}px`;
      if (box.style.minWidth !== floor) box.style.minWidth = floor;

      let chosen = narrowest;
      for (const candidate of TOOLBAR_FITS) {
        if (priceOf(candidate) <= box.clientWidth) {
          chosen = candidate;
          break;
        }
      }

      if (rendered === undefined) delete element.dataset.fit;
      else element.dataset.fit = rendered;
      setFit(chosen);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar, compact, container]);

  return fit;
}
