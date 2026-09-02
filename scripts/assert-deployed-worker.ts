#!/usr/bin/env tsx
/**
 * Asserts that `wrangler deploy` published the Worker the caller named.
 *
 * The preview workflow overrides the Worker name per pull request with
 * `--name`. If that override ever stops taking effect, every open pull request
 * would deploy over one Worker named for the environment, and each preview URL
 * would answer with somebody else's branch — silently, because the deploy
 * itself succeeds.
 *
 * Reads wrangler's own record of what it did (WRANGLER_OUTPUT_FILE_PATH, one
 * JSON object per line) rather than parsing log output. In TypeScript rather
 * than a `jq` expression in the workflow because the field name is an
 * undocumented part of wrangler's output: as a script it can be pinned by a
 * test, and a rename fails that test instead of failing every preview deploy
 * after the Worker has already gone out.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The name in the last deploy record. Wrangler writes one JSON object per
 * line, and a single invocation can emit several unrelated record types.
 */
export function deployedWorkerName(ndjson: string): string | null {
  let name: string | null = null;
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      // Wrangler owns this file's format; a line we cannot read is not ours
      // to fail on, as long as a deploy record still turns up.
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const entry = record as { type?: unknown; worker_name?: unknown };
    if (entry.type !== 'deploy') continue;
    name = typeof entry.worker_name === 'string' ? entry.worker_name : null;
  }
  return name;
}

function main(): void {
  const [outputPath, expectedName] = process.argv.slice(2);
  if (!outputPath || !expectedName) {
    throw new Error('usage: assert-deployed-worker.ts <wrangler-output-file> <expected-name>');
  }

  const deployed = deployedWorkerName(readFileSync(outputPath, 'utf8'));
  if (deployed === null) {
    throw new Error(
      'wrangler wrote no deploy record naming a Worker — its output format has changed.',
    );
  }
  if (deployed !== expectedName) {
    throw new Error(`Deployed Worker is '${deployed}', expected '${expectedName}'.`);
  }
  console.log(`Deployed Worker is ${expectedName}, as named.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
