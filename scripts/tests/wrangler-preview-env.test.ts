import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { REQUIRED_ENVIRONMENTS } from '../bootstrap/standards.js';

const WORKFLOW_DIR = resolve(import.meta.dirname, '../../.github/workflows');

/**
 * The pull request preview environment restates every binding the production
 * Worker declares, because wrangler treats binding families as
 * non-inheritable: an environment that omits one is deployed without it,
 * behind a warning nobody reads. These cases are what turns "someone
 * remembered" into a failing check.
 */

/**
 * Families wrangler will not inherit into a named environment. Discovered from
 * the production config rather than listed here, so a binding kind nobody has
 * used yet — a KV namespace, a queue, a service — is covered on the day it is
 * added rather than on the day somebody remembers to extend this list.
 */
const NON_INHERITABLE = ['vars', 'd1_databases', 'r2_buckets', 'ratelimits', 'durable_objects'];

/**
 * What may legitimately differ between the two environments: the preview
 * database is a different database, and the preview host is a different host.
 * Everything else must match, values included — a preview that throttles
 * differently is a preview of something else.
 */
const MAY_DIFFER = ['database_id', 'database_name', 'SITE_URL'];

function withoutPermittedDifferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPermittedDifferences);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !MAY_DIFFER.includes(key))
      .map(([key, nested]) => [key, withoutPermittedDifferences(nested)]),
  );
}

interface WranglerScope {
  routes?: unknown;
  triggers?: { crons?: unknown };
  vars?: { SITE_URL?: string };
  d1_databases?: { database_name?: string }[];
  [family: string]: unknown;
}

interface WranglerConfig extends WranglerScope {
  env?: { preview?: WranglerScope };
}

const production = parse(
  readFileSync(resolve(import.meta.dirname, '../../apps/worker/wrangler.toml'), 'utf8'),
) as WranglerConfig;
const preview = production.env?.preview;

describe('the preview environment', () => {
  it('exists, because the preview workflow deploys from it', () => {
    expect(preview).toBeDefined();
  });

  it('declares no routes, so a preview cannot take the custom domain from production', () => {
    // `routes` is inheritable. An environment that omits it inherits the
    // top-level custom domain and reassigns map.lasvegasfortransit.org to
    // itself on every deploy. The empty array is the whole guard.
    expect(preview?.routes).toEqual([]);
  });

  it('declares no cron triggers, so open pull requests do not run maintenance', () => {
    expect(preview?.triggers?.crons).toEqual([]);
  });

  it('binds a database that is not production', () => {
    expect(preview?.d1_databases).toHaveLength(1);
    expect(preview?.d1_databases?.[0]?.database_name).not.toBe(
      production.d1_databases?.[0]?.database_name,
    );
  });

  it('keeps a site URL placeholder that the deployment must override', () => {
    // The real host is per-pull-request and injected with `--var`. If this
    // ever equals the production URL, previews quietly claim to be the live
    // site in every canonical tag and oEmbed response they serve.
    expect(preview?.vars?.SITE_URL).toBeDefined();
    expect(preview?.vars?.SITE_URL).not.toBe(production.vars?.SITE_URL);
  });

  it.each(NON_INHERITABLE)('restates %s exactly, values included', (family) => {
    // Names alone would let a restated rate limit drift to a different budget,
    // and would say nothing about a family added to production later.
    expect(withoutPermittedDifferences(preview?.[family])).toEqual(
      withoutPermittedDifferences(production[family]),
    );
  });

  it('classifies every top-level key, so a new binding kind cannot slip past', () => {
    // The guard on the guard. The case above only checks families listed in
    // NON_INHERITABLE, so a `[[kv_namespaces]]` or `[[queues.producers]]`
    // added to production would be dropped from the preview Worker silently.
    // Anything that is neither a known inheritable key nor a family we check
    // has to be classified here before it can ship.
    const INHERITABLE = [
      'name',
      'main',
      'compatibility_date',
      'compatibility_flags',
      'observability',
      'assets',
      'exports',
      'migrations',
      'triggers',
      'routes',
      'route',
      'workers_dev',
      'preview_urls',
      'limits',
      'placement',
      'env',
    ];
    const unclassified = Object.keys(production).filter(
      (key) => !INHERITABLE.includes(key) && !NON_INHERITABLE.includes(key),
    );
    expect(unclassified).toEqual([]);
  });
});

describe('the GitHub environments the workflows name', () => {
  it('are the environments bootstrap provisions credentials for', () => {
    // The only reason these environments must exist is that deployment jobs
    // name them. Renaming one in YAML would leave bootstrap provisioning an
    // environment nobody uses, while every deploy failed for want of secrets.
    const workflows = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'));
    const named = new Set<string>();
    for (const workflow of workflows) {
      const source = readFileSync(resolve(WORKFLOW_DIR, workflow), 'utf8');
      for (const [, name] of source.matchAll(/^\s*environment:\s*\n\s*name:\s*(\S+)/gmu)) {
        if (name) named.add(name);
      }
      for (const [, name] of source.matchAll(/^\s*environment:\s*([A-Za-z][\w-]*)\s*$/gmu)) {
        if (name) named.add(name);
      }
    }

    expect(named.size).toBeGreaterThan(0);
    expect([...named].sort()).toEqual([...REQUIRED_ENVIRONMENTS].sort());
  });
});
