import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

function missing(error: unknown): null {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
  throw error;
}
export const readOptional = (file: string) => readFile(file, 'utf8').catch(missing);

/** Shared publication never follows a consumer symlink to unrelated checkout content. */
export async function rejectSymlinkDestination(root: string, file: string): Promise<void> {
  if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))
    throw new Error(`Invalid shared destination ${file}.`);
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    const entry = await lstat(current).catch(missing);
    if (entry?.isSymbolicLink())
      throw new Error(`${file} contains a symlink; shared publication cannot follow it.`);
  }
}
