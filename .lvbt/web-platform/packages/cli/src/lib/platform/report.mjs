import { readiness } from './plan.mjs';
import { paint } from './terminal.mjs';

function mark(entry) {
  if (entry.status === 'ok') return paint('green', 'ok  ');
  if (entry.level === 'required') return paint('red', 'FAIL');
  return paint('yellow', 'WARN');
}

/**
 * The readiness report: one line per item under its section, the next step
 * under anything that is not ok, then a summary grouped by urgency.
 */
export function formatReport({ title, items }) {
  const width = Math.min(Math.max(...items.map((entry) => entry.label.length), 10), 44);
  const lines = [paint('bold', title)];
  let section;
  for (const entry of items) {
    if (entry.section !== section) {
      section = entry.section;
      lines.push('', paint('bold', section));
    }
    lines.push(`  ${mark(entry)}  ${entry.label.padEnd(width)}  ${entry.detail}`);
    if (entry.status !== 'ok' && entry.next)
      lines.push(`        ${' '.repeat(width)}  next: ${entry.next}`);
  }
  const summary = readiness(items);
  lines.push('');
  const parts = [`${summary.ok} of ${items.length} ready`];
  if (summary.now.length > 0) parts.push(paint('red', `${summary.now.length} needed now`));
  if (summary.later.length > 0)
    parts.push(paint('yellow', `${summary.later.length} for features not built yet`));
  if (summary.recommended.length > 0)
    parts.push(paint('yellow', `${summary.recommended.length} recommended`));
  lines.push(
    `${summary.ready ? paint('green', 'Ready for production.') : paint('red', 'Not ready for production.')} ${parts.join(', ')}.`,
  );
  return `${lines.join('\n')}\n`;
}
