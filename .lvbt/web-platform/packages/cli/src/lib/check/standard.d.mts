export const STANDARD_COMMANDS: Record<string, string>;
export function standardCommandsFor(options?: { vendored?: boolean }): Record<string, string>;
export function standardCommands(cwd: string): Record<string, string>;
export function checkStandard(options: { cwd: string }): Promise<{
  name: string;
  ok: boolean;
  lines: string[];
  fix: string;
}>;
