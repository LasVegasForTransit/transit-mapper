import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { log, note } from '@clack/prompts';
import {
  runCommand,
  runInteractiveCommand,
  tryOpenInBrowser,
  type CommandResult,
  type RunOptions,
} from './shell.js';
import { formatToolTable, promptConfirm, promptSecret, type ToolRow } from './ui.js';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/**
 * Everything the bootstrap does outside its own memory: commands, the files
 * it reads and edits, the questions it asks, and what it prints.
 *
 * One seam, so a test can run every phase in order against fakes and count
 * exactly what a run would have changed. Production passes `nodeIo()`, which
 * does what the phases did directly before the seam existed.
 */
export interface BootstrapIo {
  /** Runs a non-interactive command through /bin/sh from the repository root. */
  run: (command: string, options?: RunOptions) => CommandResult;
  /** Runs a command attached to the terminal, for the login flows. */
  runInteractive: (command: string) => boolean;
  /** Reads a file by its path relative to the repository root. */
  readFile: (relativePath: string) => string;
  /** Writes a file by its path relative to the repository root. */
  writeFile: (relativePath: string, content: string) => void;
  confirm: (message: string, initialValue: boolean) => Promise<boolean>;
  /** Masked prompt. The answer is never echoed or logged. */
  secret: (message: string) => Promise<string>;
  openUrl: (url: string) => boolean;
  note: (body: string, title: string) => void;
  /** A phase's status table. Structured so a test can read the statuses. */
  table: (title: string, rows: readonly ToolRow[]) => void;
  log: (level: LogLevel, message: string) => void;
}

/** The real terminal, file system, and subprocesses, rooted at `root`. */
export function nodeIo(root: string = process.cwd()): BootstrapIo {
  return {
    run: (command, options = {}) => runCommand(command, { ...options, cwd: root }),
    runInteractive: (command) => runInteractiveCommand(command, root),
    readFile: (relativePath) => readFileSync(path.resolve(root, relativePath), 'utf8'),
    writeFile: (relativePath, content) => {
      writeFileSync(path.resolve(root, relativePath), content, 'utf8');
    },
    confirm: promptConfirm,
    secret: promptSecret,
    openUrl: tryOpenInBrowser,
    note: (body, title) => {
      note(body, title);
    },
    table: (title, rows) => {
      if (rows.length > 0) note(formatToolTable(rows), title);
    },
    log: (level, message) => {
      log[level](message);
    },
  };
}
