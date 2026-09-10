import { readFile, stat } from 'node:fs/promises';

export async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
