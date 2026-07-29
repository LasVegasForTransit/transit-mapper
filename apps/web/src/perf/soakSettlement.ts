export interface SoakPointerPage {
  mouse: {
    click(x: number, y: number, options: { button: 'middle' }): Promise<void>;
  };
  locator(selector: string): {
    first(): {
      boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    };
  };
}

export async function settleKeyboardPointerSentinels(page: SoakPointerPage): Promise<void> {
  const bounds = await page.locator('.maplibregl-canvas').first().boundingBox();
  if (!bounds) throw new Error('The main map canvas is unavailable for soak settlement.');

  // Radix Menu registers one-shot pointerdown/pointermove listeners after a
  // keydown. A middle click consumes both without selecting or editing the map.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: 'middle',
  });
}
