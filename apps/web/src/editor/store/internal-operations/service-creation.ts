import type { TransitSystem } from '@transitmapper/core/model/system';
import { modeRender } from '@transitmapper/core/style/catalogStyle';

export const DEFAULT_FREQUENCY_MINUTES = 10;
export const DEFAULT_SPAN_START = '06:00';
export const DEFAULT_SPAN_END = '23:00';

export function nextDefaultLineName(system: TransitSystem): string {
  const used = new Set(
    system.lines.flatMap((line) => {
      const match = /^Line ([1-9]\d*)$/.exec(line.name);
      return match ? [Number(match[1])] : [];
    }),
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return `Line ${number}`;
}

/** Chooses a deterministic public Line color not already used in this document. */
export function unusedPaletteColor(system: TransitSystem, modeId: string): string {
  const used = new Set(system.lines.map((line) => line.color.toLowerCase()));
  const paletteColor = system.palette.find((color) => !used.has(color.toLowerCase()));
  if (paletteColor) return paletteColor;
  const modeColor = modeRender(modeId).color;
  if (!used.has(modeColor.toLowerCase())) return modeColor;

  let start = 0;
  for (const char of modeId) start = (start * 31 + char.charCodeAt(0)) & 0xffffff;
  for (let offset = 0; offset <= 0xffffff; offset += 1) {
    const color = `#${((start + offset) & 0xffffff).toString(16).padStart(6, '0')}`;
    if (!used.has(color)) return color;
  }
  throw new Error('No unused Line color remains.');
}
