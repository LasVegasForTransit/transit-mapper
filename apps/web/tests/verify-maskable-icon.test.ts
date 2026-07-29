import { readFile } from 'node:fs/promises';

const SOURCE = new URL('../public/icon-maskable.svg', import.meta.url);

const svg = await readFile(SOURCE, 'utf8');

if (!svg.includes('<rect width="100" height="100" fill="#f4f4f1" />')) {
  throw new Error('maskable icon source needs an opaque TransitMapper background.');
}
if (!svg.includes('transform="translate(17.5 17.5) scale(0.65)"')) {
  throw new Error('maskable icon source must keep the mark inside its safe zone.');
}
