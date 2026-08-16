interface RenderSettlementElement {
  dataset: DOMStringMap | Record<string, string | undefined>;
}

export interface RenderSettlementMarker {
  clear(): void;
  markSettled(): void;
}

/** A DOM-visible statement that a secondary renderer has finished its own
 * source/layout/paint cycle. Browser evidence can wait on this condition
 * instead of guessing with a timeout, and it remains inert to presentation. */
export function createRenderSettlementMarker(
  element: RenderSettlementElement,
): RenderSettlementMarker {
  const clear = () => {
    delete element.dataset.renderSettled;
  };
  clear();
  return {
    clear,
    markSettled: () => {
      element.dataset.renderSettled = 'true';
    },
  };
}
