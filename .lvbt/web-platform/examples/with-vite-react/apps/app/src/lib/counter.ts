/** The next count after a click. Counts never go below one. */
export function nextCount(current: number): number {
  return Math.max(0, current) + 1;
}
