import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChromeIcon } from './chrome-icon';

export interface MenuCardProps {
  brand: ReactNode;
  children: ReactNode;
  chromeHidden: boolean;
  representationLabel: string;
  onToggleInterface: () => void;
}

function useAnimatedMenuCardWidth(chromeHidden: boolean) {
  const cardRef = useRef<HTMLElement | null>(null);
  const openWidthRef = useRef(0);
  const collapsedWidthRef = useRef(0);

  useLayoutEffect(() => {
    if (!chromeHidden && cardRef.current?.style.width === '') {
      openWidthRef.current = cardRef.current.getBoundingClientRect().width;
    }
  });

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;

    const measureNaturalWidth = () => {
      const previous = element.style.width;
      element.style.width = 'auto';
      const width = element.getBoundingClientRect().width;
      element.style.width = previous;
      return width;
    };

    let targetWidth: number;
    if (chromeHidden) {
      collapsedWidthRef.current = measureNaturalWidth();
      element.style.width = `${openWidthRef.current}px`;
      targetWidth = collapsedWidthRef.current;
    } else if (collapsedWidthRef.current > 0) {
      element.style.width = `${collapsedWidthRef.current}px`;
      targetWidth = openWidthRef.current;
    } else {
      element.style.width = '';
      return;
    }

    const brandElement = element.querySelector('.workspace-menu-card-header');
    let observer: ResizeObserver | null = null;
    let targetFrame = 0;
    const startFrame = requestAnimationFrame(() => {
      targetFrame = requestAnimationFrame(() => {
        element.style.width = `${targetWidth}px`;
        if (chromeHidden && brandElement) {
          observer = new ResizeObserver(() => {
            collapsedWidthRef.current = measureNaturalWidth();
            element.style.width = `${collapsedWidthRef.current}px`;
          });
          observer.observe(brandElement);
        }
      });
    });

    const releaseOpenWidth = (event: TransitionEvent) => {
      if (!chromeHidden && event.propertyName === 'width') element.style.width = '';
    };
    element.addEventListener('transitionend', releaseOpenWidth);
    return () => {
      cancelAnimationFrame(startFrame);
      cancelAnimationFrame(targetFrame);
      observer?.disconnect();
      element.removeEventListener('transitionend', releaseOpenWidth);
    };
  }, [chromeHidden]);

  return cardRef;
}

export function MenuCard({
  brand,
  children,
  chromeHidden,
  representationLabel,
  onToggleInterface,
}: MenuCardProps) {
  const cardRef = useAnimatedMenuCardWidth(chromeHidden);

  return (
    <aside ref={cardRef} className="workspace-menu-card" aria-label={representationLabel}>
      <div className="workspace-menu-card-header">
        <div className="workspace-menu-card-header-row">
          {brand}
          <button
            type="button"
            className="workspace-interface-toggle"
            title={chromeHidden ? 'Show interface' : 'Hide interface'}
            aria-label={chromeHidden ? 'Show interface' : 'Hide interface'}
            onClick={onToggleInterface}
          >
            <ChromeIcon name={chromeHidden ? 'panelOpen' : 'sidebar'} size={16} />
          </button>
        </div>
      </div>
      <div className="workspace-menu-card-content">
        <div className="workspace-menu-card-content-inner">{children}</div>
      </div>
    </aside>
  );
}
