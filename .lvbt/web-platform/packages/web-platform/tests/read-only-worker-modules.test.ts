import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  assertReadOnlyWorkerModule,
  verifyReadOnlyWorkerModules,
} from '../src/read-only-worker-modules.js';
import { verifyWorkerReleaseConfiguration } from '../src/worker-release-configuration.js';

test('reviewed handler modules may import only the native DurableObject superclass', () => {
  expect(() =>
    assertReadOnlyWorkerModule(
      "import {DurableObject as Base} from 'cloudflare:workers'; export class Gate extends Base {};",
    ),
  ).not.toThrow();
  expect(() =>
    assertReadOnlyWorkerModule("const documentation='cloudflare:workers'; export default {};"),
  ).not.toThrow();
});

test.each([
  "import {env} from 'cloudflare:workers';",
  "import {env as bindings,DurableObject} from 'cloudflare:workers';",
  "import * as native from 'cloudflare:workers';",
  "import native from 'cloudflare:workers';",
  "export {env} from 'cloudflare:workers';",
  "export * from 'cloudflare:workers';",
  "const native=await import('cloudflare:workers');",
  "const native=await import('cloudflare:'+'workers');",
  'const native=await import(target);',
  "import {env} from 'cloudflare:\\u0077orkers';",
  "const native=require('cloudflare:workers');",
  'const native=__require(target);',
])('shared read-only modules reject global or unverified binding access: %s', (source) => {
  expect(() => assertReadOnlyWorkerModule(source)).toThrow('read-only');
});

test.each(['escape.js', 'escape.mjs', 'escape.cjs'])(
  'every retained nested JavaScript module is checked before shared binding use: %s',
  async (module) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'readonly-modules-'));
    try {
      await mkdir(path.join(root, '.wrangler/worker/bundle'), { recursive: true });
      await writeFile(path.join(root, '.wrangler/worker/index.js'), 'export default {}');
      await writeFile(
        path.join(root, '.wrangler/worker/bundle', module),
        "import {env} from 'cloudflare:workers';",
      );
      await expect(verifyReadOnlyWorkerModules(root)).rejects.toThrow('read-only');
      await writeFile(
        path.join(root, '.wrangler/worker/preview-capabilities.json'),
        JSON.stringify({ readOnlyBindings: ['DATA'] }),
      );
      const buckets = [{ binding: 'DATA', bucket_name: 'public-feed' }];
      await writeFile(
        path.join(root, 'wrangler.jsonc'),
        JSON.stringify({
          name: 'app',
          r2_buckets: buckets,
          env: { preview: { name: 'app-preview', r2_buckets: buckets } },
        }),
      );
      await expect(
        verifyWorkerReleaseConfiguration(root, {
          productionWorker: 'app',
          previewWorker: 'app-preview',
          previewReadOnlyBindings: ['DATA'],
        }),
      ).rejects.toThrow('read-only');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
