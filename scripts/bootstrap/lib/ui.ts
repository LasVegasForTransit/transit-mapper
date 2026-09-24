import { cancel, confirm, isCancel, password, text } from '@clack/prompts';

export type ToolRowStatus = 'ready' | 'failed' | 'deferred' | 'skipped';

export interface ToolRow {
  label: string;
  status: ToolRowStatus;
  detail?: string;
}

const STATUS_GLYPH: Record<ToolRowStatus, string> = {
  ready: '✔',
  failed: '✖',
  deferred: '—',
  skipped: '·',
};

/** One aligned line per row, glyph first, for a `note()` body. */
export function formatToolTable(rows: readonly ToolRow[]): string {
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  return rows
    .map((r) => `${STATUS_GLYPH[r.status]}  ${r.label.padEnd(labelWidth)}  ${r.detail ?? ''}`)
    .join('\n');
}

export async function promptOrExit<T>(
  promise: Promise<T>,
  cancelMessage = 'Bootstrap cancelled.',
): Promise<T> {
  const result = await promise;
  if (isCancel(result)) {
    cancel(cancelMessage);
    process.exit(1);
  }
  return result;
}

export async function promptConfirm(message: string, initialValue: boolean): Promise<boolean> {
  const result = await promptOrExit(confirm({ message, initialValue }));
  return result === true;
}

/** Masked prompt for secrets — never echoed, never logged. */
export async function promptSecret(message: string): Promise<string> {
  const result = await promptOrExit(
    password({
      message,
      validate: (value) => ((value ?? '').trim().length === 0 ? 'Required' : undefined),
    }),
  );
  return result as string;
}

/**
 * Plain prompt for a value that is not secret. `check` returns the reason a
 * value is refused, or undefined to accept it.
 */
export async function promptText(
  message: string,
  check: (value: string) => string | undefined,
): Promise<string> {
  const result = await promptOrExit(
    text({ message, validate: (value) => check((value ?? '').trim()) }),
  );
  return (result as string).trim();
}
