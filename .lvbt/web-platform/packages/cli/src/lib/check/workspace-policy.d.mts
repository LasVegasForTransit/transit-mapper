export interface ScalarRecord {
  key: string;
  value: string;
  index: number;
  valueStart: number;
  valueLength: number;
  quote: string;
}
export function scalarSection(
  source: string,
  name: string,
): { entries: Record<string, string>; records: ScalarRecord[]; start: number; end: number };
export function catalogEntries(source: string): Record<string, string>;
export function overrideProblems(source: string, policy: Record<string, string>): string[];
export function updateOverrides(source: string, policy: Record<string, string>): string;
