/**
 * Parses the compact service-time grammar used by both legacy documents and
 * the simulation. Invalid input stays invalid instead of becoming midnight.
 */
export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
